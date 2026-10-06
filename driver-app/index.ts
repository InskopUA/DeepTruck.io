// The task must be registered before React mounts, including headless starts.
import './src/tracking';
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
