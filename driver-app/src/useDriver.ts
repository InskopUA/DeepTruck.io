import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking as NativeLinking } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './auth';
import { ApiError, getLoads, loadAction, pauseAll } from './api';
import { captureIfDue, captureNow, flushQueue, locationAccess, requestLocationPermissions, stopCollecting, syncTracking, trackingHealth } from './tracking';
import { closed, effectiveLoad, initialAccess, initialHealth, locationReady } from './driver-state';
import type { Load } from './types';

function normalizePhone(value: string) {
  let number = value.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(number)) number = '+1' + number;
  if (/^1\d{10}$/.test(number)) number = '+' + number;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error('Enter your phone number with country code.');
  return number;
}
function confirm(title: string, message: string, label: string): Promise<boolean> {
  return new Promise(resolve => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: label, onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

export function useDriver() {
  const [session, setSession] = useState<Session | null>(null), [booting, setBooting] = useState(true);
  const [number, setNumber] = useState(''), [otp, setOtp] = useState(''), [codeSent, setCodeSent] = useState(false), [nextSmsAt, setNextSmsAt] = useState(0);
  const [loads, setLoads] = useState<Load[]>([]), [loadsLoaded, setLoadsLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [message, setMessage] = useState('');
  const [screen, setScreen] = useState<'loads' | 'history' | 'profile'>('loads'), [now, setNow] = useState(Date.now()), [invite, setInvite] = useState('');
  const [health, setHealth] = useState(initialHealth), [access, setAccess] = useState(initialAccess);
  const [permissionOpen, setPermissionOpen] = useState(false), [permissionStep, setPermissionStep] = useState<'intro' | 'settings'>('intro');
  const userRef = useRef(''), busyRef = useRef(false), refreshingRef = useRef(false), revision = useRef(0);
  const startIntent = useRef<string | null>(null), returningFromSettings = useRef(false), mounted = useRef(true);
  const url = Linking.useURL();
  useEffect(() => { if (!url) return; try { const id = Linking.parse(url).queryParams?.invite; if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) { setInvite(id); setScreen('loads'); } } catch {} }, [url]);
  useEffect(() => {
    mounted.current = true;
    supabase.auth.getSession().then(({ data, error }) => { if (!mounted.current) return; setSession(data.session); userRef.current = data.session?.user.id || ''; if (error) setMessage(error.message); setBooting(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, value) => {
      setSession(value); userRef.current = value?.user.id || '';
      if (!value) { startIntent.current = null; returningFromSettings.current = false; setPermissionOpen(false); setLoads([]); setHealth(initialHealth); void stopCollecting(true).catch(() => {}); }
    });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; subscription.unsubscribe(); clearInterval(clock); supabase.auth.stopAutoRefresh(); };
  }, []);
  const refresh = useCallback(async () => {
    if (!userRef.current || refreshingRef.current || busyRef.current) return;
    refreshingRef.current = true; setRefreshing(true); const owner = userRef.current, version = revision.current;
    let received = false;
    try {
      const data = await getLoads(); if (owner !== userRef.current || version !== revision.current) return;
      setLoads(data.items); setLoadsLoaded(true); setLoadError(''); received = true;
      setAccess(await locationAccess());
      await syncTracking(data.items);
      // Foreground refresh also requests a real fix when the phone is stationary.
      await captureIfDue(); await flushQueue(); setHealth(await trackingHealth());
    } catch (error) {
      if (owner !== userRef.current || version !== revision.current) return;
      if (error instanceof ApiError && error.status === 401) {
        await stopCollecting(true); await supabase.auth.signOut({ scope: 'local' }); setMessage('Sign in again to continue.');
      } else if (received) { setMessage(errorText(error)); setHealth(await trackingHealth()); }
      else setLoadError(errorText(error));
    } finally { refreshingRef.current = false; setRefreshing(false); }
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; revision.current++; setBusy(true); setMessage('');
    try { await fn(); } catch (error) { setMessage(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  async function startLoad(id: string) {
    // Refresh status before retrying: an earlier accept may have reached the server.
    const current = (await getLoads()).items.find(load => load.id === id);
    if (!current || closed(effectiveLoad(current, Date.now()).status)) throw new Error('This invitation is no longer available.');
    if (current.status === 'pending') await loadAction(id, 'accept');
    await loadAction(id, 'start');
    const data = await getLoads(); setLoads(data.items); setLoadsLoaded(true);
    try { await syncTracking(data.items, true); }
    catch (error) { await loadAction(id, 'pause').catch(() => {}); setLoads((await getLoads()).items); setHealth(await trackingHealth()); throw error; }
    setHealth({ ...await trackingHealth(), lastCapture: null }); setLoadError(''); setPermissionOpen(false); startIntent.current = null;
    // Show the active load immediately, then update the actual GPS delivery state.
    const owner = userRef.current;
    void captureNow().then(async () => { if (mounted.current && userRef.current === owner) setHealth(await trackingHealth()); }).catch(error => { if (mounted.current && userRef.current === owner) setMessage(errorText(error)); });
  }
  async function beginStart(load: Load) {
    await run(async () => {
      const next = await locationAccess(); setAccess(next); startIntent.current = load.id;
      if (locationReady(next)) await startLoad(load.id);
      else { setPermissionStep('intro'); setPermissionOpen(true); }
    });
  }
  async function enableLocation() {
    await run(async () => {
      try { await requestLocationPermissions(); }
      catch { const next = await locationAccess(); setAccess(next); setPermissionStep('settings'); return; }
      const next = await locationAccess(); setAccess(next);
      if (!locationReady(next)) { setPermissionStep('settings'); return; }
      if (startIntent.current) await startLoad(startIntent.current); else setPermissionOpen(false);
    });
  }
  function closePermission() { if (busyRef.current) return; startIntent.current = null; returningFromSettings.current = false; setPermissionOpen(false); setMessage(''); }
  function showPermissions() { startIntent.current = null; setPermissionStep('intro'); setPermissionOpen(true); setMessage(''); }
  async function openProfileSettings() { startIntent.current = null; await openSettings(); }
  async function openSettings() { returningFromSettings.current = true; try { await NativeLinking.openSettings(); } catch { returningFromSettings.current = false; setMessage('Open Settings → DeepTruck Driver → Location → Always.'); } }
  useEffect(() => {
    userRef.current = session?.user.id || ''; setLoads([]); setLoadsLoaded(false); setLoadError('');
    if (!session) return;
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15000);
    const resume = AppState.addEventListener('change', state => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        if (returningFromSettings.current) {
          returningFromSettings.current = false;
          void run(async () => { const next = await locationAccess(); setAccess(next); if (locationReady(next)) { if (startIntent.current) await startLoad(startIntent.current); else setPermissionOpen(false); } else { setPermissionStep('settings'); await stopCollecting(true); setHealth(await trackingHealth()); } });
        } else void refresh();
      } else supabase.auth.stopAutoRefresh();
    });
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    return () => { clearInterval(timer); resume.remove(); };
  }, [session?.user.id, refresh]);
  async function sendCode() { await run(async () => { if (Date.now() < nextSmsAt) throw new Error('Please wait before requesting another code.'); const phone = normalizePhone(number); setNumber(phone); const { error } = await supabase.auth.signInWithOtp({ phone }); if (error) throw error; setCodeSent(true); setNextSmsAt(Date.now() + 60000); }); }
  async function verifyCode() { await run(async () => { if (!/^\d{6}$/.test(otp)) throw new Error('Enter the six-digit SMS code.'); const { error } = await supabase.auth.verifyOtp({ phone: normalizePhone(number), token: otp, type: 'sms' }); if (error) throw error; setOtp(''); setCodeSent(false); }); if (userRef.current) void refresh(); }
  async function act(load: Load, action: 'accept' | 'decline' | 'pause' | 'complete') {
    if (action === 'complete' && !await confirm('Complete delivery?', 'Location access for this load will close.', 'Complete delivery')) return;
    if (action === 'decline' && !await confirm('Decline invitation?', load.title, 'Decline')) return;
    await run(async () => {
      if (action === 'pause' && loads.filter(item => item.status === 'active').length === 1) await stopCollecting(true);
      await loadAction(load.id, action); const data = await getLoads(); setLoads(data.items);
      await syncTracking(data.items); await flushQueue(); setHealth(await trackingHealth());
    });
  }
  async function stopAll(signOut = false) {
    if (!await confirm(signOut ? 'Sign out?' : 'Pause all tracking?', 'Location sharing for your active loads will stop.', signOut ? 'Sign out' : 'Pause all')) return;
    await run(async () => {
      await stopCollecting(true); setHealth(await trackingHealth());
      try { await pauseAll(); } catch (error) { if (signOut && error instanceof ApiError && error.status === 401) { await supabase.auth.signOut({ scope: 'local' }); return; } throw new Error('Tracking stopped on this phone. Connect to the internet to finish.'); }
      if (signOut) { const { error } = await supabase.auth.signOut(); if (error) throw error; }
      else setLoads((await getLoads()).items);
    });
  }
  const effective = loads.map(load => effectiveLoad(load, now));
  const visible = effective.filter(load => screen === 'history' ? closed(load.status) : !closed(load.status)).sort((a, b) => a.id === invite ? -1 : b.id === invite ? 1 : 0);
  return { session, booting, number, setNumber, otp, setOtp, codeSent, nextSmsAt, sendCode, verifyCode, changeNumber: () => { setCodeSent(false); setOtp(''); setMessage(''); }, loads: effective, visible, loadsLoaded, loadError, busy, refreshing, refresh, message, dismissMessage: () => setMessage(''), screen, setScreen, now, invite, health, access, permissionOpen, permissionStep, beginStart, enableLocation, openSettings, closePermission, showPermissions, openProfileSettings, permissionForLoad: startIntent.current !== null, act, stopAll };
}
export type DriverController = ReturnType<typeof useDriver>;
