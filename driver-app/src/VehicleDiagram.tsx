import React from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import Svg,{Path,Rect,Circle,G} from 'react-native-svg';
import {DAMAGE_AREAS,type VehicleView} from '../../supabase/functions/_shared/damage-codes';

const views:VehicleView[]=['left','right','front','rear','top'];
export function VehicleDiagram({view,onView,selected,onSelect,marked=[]}:{view:VehicleView;onView:(v:VehicleView)=>void;selected:string;onSelect:(id:string)=>void;marked?:string[]}){
  const side=view==='left'||view==='right',prefix=view==='right'?'right':'left';
  function props(id:string){return {fill:selected===id?'#bad8ff':marked.includes(id)?'#dbe9fa':'#edf2f8',stroke:selected===id?'#286bc0':'#9aacc2',strokeWidth:selected===id?2.5:1.2,onPress:()=>onSelect(id),accessible:true,accessibilityLabel:DAMAGE_AREAS.find(a=>a.id===id)?.label};}
  return <View style={s.root}><View style={s.tabs}>{views.map(v=><Pressable key={v} accessibilityRole="tab" accessibilityState={{selected:view===v}} onPress={()=>onView(v)} style={[s.tab,view===v&&s.active]}><Text style={[s.tabText,view===v&&s.blue]}>{v[0].toUpperCase()+v.slice(1)}</Text></Pressable>)}</View>
    <Svg width="100%" height={side?166:210} viewBox={side?'0 0 360 180':'0 0 300 260'}>
      {side?<G>
        <Path d="M25 112 L31 96 Q34 90 68 85 L107 47 Q114 40 132 40 L210 40 Q228 41 249 69 L270 88 L322 99 Q333 103 335 118 L333 139 L26 139 Z" fill="#f8fafc" stroke="#9aacc2" strokeWidth={1.5}/>
        <Path d="M35 98 L90 89 L96 108 L97 139 L31 139 L31 113 Z" {...props(prefix+'-front-fender')}/>
        <Path d="M103 92 L169 92 L169 137 L105 137 Z" {...props(prefix+'-front-door')}/>
        <Path d="M175 92 L239 92 L251 110 L251 137 L175 137 Z" {...props(prefix+'-rear-door')}/>
        <Path d="M258 96 L322 105 L330 118 L329 138 L258 138 Z" {...props(prefix+'-rear-quarter')}/>
        <Path d="M103 83 L119 51 L169 51 L169 83 Z" {...props(prefix+'-front-window')}/>
        <Path d="M175 51 L208 51 Q220 52 239 83 L175 83 Z" {...props(prefix+'-rear-window')}/>
        <Rect x={91} y={79} width={20} height={13} rx={4} {...props(prefix+'-mirror')}/>
        <Rect x={105} y={142} width={148} height={10} rx={3} {...props(prefix+'-rocker')}/>
        {[{x:76,pos:'front'},{x:284,pos:'rear'}].map(w=><G key={w.pos}><Circle cx={w.x} cy={139} r={24} {...props(`${prefix}-${w.pos}-tire`)}/><Circle cx={w.x} cy={139} r={14} {...props(`${prefix}-${w.pos}-wheel`)}/><Circle cx={w.x} cy={139} r={4} fill="#9aacc2" pointerEvents="none"/></G>)}
      </G>:view==='top'?<G>
        <Path d="M91 26 Q150 8 209 26 Q224 48 224 117 L222 207 Q218 235 203 242 L97 242 Q82 235 78 207 L76 117 Q76 48 91 26 Z" fill="#f8fafc" stroke="#9aacc2" strokeWidth={1.5}/>
        <Path d="M93 32 Q150 18 207 32 L210 91 L90 91 Z" {...props('hood')}/>
        <Path d="M92 96 L208 96 L199 128 L101 128 Z" {...props('windshield')}/>
        <Rect x={100} y={133} width={100} height={59} rx={5} {...props('roof')}/>
        <Path d="M101 197 L199 197 L208 219 L92 219 Z" {...props('rear-glass')}/>
        <Path d="M94 225 L206 225 L201 236 L99 236 Z" {...props('trunk')}/>
      </G>:<G>
        <Path d="M58 175 L59 104 L83 86 L98 42 Q150 29 202 42 L217 86 L241 104 L242 175 Z" fill="#f8fafc" stroke="#9aacc2" strokeWidth={1.5}/>
        <Path d="M101 46 Q150 34 199 46 L210 84 L90 84 Z" {...props(view==='front'?'windshield':'rear-glass')}/>
        <Path d="M81 93 L219 93 L229 134 L71 134 Z" {...props(view==='front'?'hood':'trunk')}/>
        <Rect x={62} y={140} width={176} height={34} rx={7} {...props(view==='front'?'front-bumper':'rear-bumper')}/>
        <Rect x={69} y={183} width={30} height={19} rx={4} fill="#c7d1de"/><Rect x={201} y={183} width={30} height={19} rx={4} fill="#c7d1de"/>
        <Path d="M71 113 L96 116 M204 116 L229 113" stroke="#9aacc2" strokeWidth={6} pointerEvents="none"/>
      </G>}
    </Svg><Text style={s.hint}>Tap a part of the vehicle</Text>
    <View style={s.parts}>{DAMAGE_AREAS.filter(a=>a.view===view || (view==='top'&&['windshield','rear-glass','trunk'].includes(a.id)) || (view==='front'&&a.id==='hood')).map(a=><Pressable key={a.id} onPress={()=>onSelect(a.id)} style={[s.part,selected===a.id&&s.selected]} accessibilityRole="button" accessibilityState={{selected:selected===a.id}}><Text style={[s.partText,selected===a.id&&s.blue]}>{a.label.replace(/^(Left|Right) /,'')}{marked.includes(a.id)?' •':''}</Text></Pressable>)}</View>
  </View>;
}
const s=StyleSheet.create({root:{gap:12},tabs:{flexDirection:'row',backgroundColor:'#edf2f8',padding:4,borderRadius:9},tab:{flex:1,minHeight:36,alignItems:'center',justifyContent:'center',borderRadius:6},active:{backgroundColor:'white'},tabText:{fontSize:12,color:'#68788b',fontWeight:'500'},blue:{color:'#286bc0'},hint:{fontSize:11,color:'#68788b',textAlign:'center'},parts:{flexDirection:'row',flexWrap:'wrap',gap:7},part:{paddingHorizontal:11,paddingVertical:9,borderWidth:1,borderColor:'#e4eaf1',borderRadius:7},selected:{borderColor:'#85b4eb',backgroundColor:'#edf4ff'},partText:{fontSize:11,color:'#202c3d'}});
