import * as settings from './settings.js';
import * as icons from './icons.js';
import * as utilities from './utilities.js';
import * as host from './host.js';
import * as navigation from './navigation.js';
import * as editing from './editing.js';
import * as selection from './selection.js';
import * as messageContent from './message-content.js';
import * as range from './range.js';
import * as actions from './actions.js';
import * as toolbar from './toolbar.js';
import * as favoritePreview from './favorite-preview.js';
import * as favoriteManager from './favorite-manager.js';
import * as favoriteStore from './favorite-store.js';
import * as favoriteActions from './favorite-actions.js';
import * as favoritePanel from './favorite-panel.js';
import * as chatLifecycle from './chat-lifecycle.js';
import * as settingsUI from './settings-ui.js';
import * as lifecycle from './lifecycle.js';
import { createState } from './state.js';

const features = [settings, icons, utilities, host, navigation, editing, selection, messageContent, range, actions, toolbar, favoritePreview, favoriteManager, favoriteStore, favoriteActions, favoritePanel, chatLifecycle, settingsUI, lifecycle];

/** Compose an isolated instance. Host imports are injected only at the entry point. */
export function createApplication(hostImports) {
  const state = createState();
  const dependencies = Object.create(null);
  for (const feature of features) {
    // Each feature sees only its declared dependencies, not a global service locator.
    // Getters defer resolution until every factory has registered its services.
    const injected = Object.create(null);
    for (const name of feature.requiredServices) {
      Object.defineProperty(injected, name, { enumerable: true, get: () => dependencies[name] });
    }
    const services = feature.createFeature({ state, dependencies: Object.freeze(injected), hostImports });
    for (const [name, service] of Object.entries(services)) {
      if (name in dependencies) throw new Error('Duplicate STCJ service: ' + name);
      dependencies[name] = service;
    }
  }
  for (const feature of features) {
    for (const name of feature.requiredServices) {
      if (typeof dependencies[name] !== 'function') throw new Error('Missing STCJ service: ' + name);
    }
  }
  Object.freeze(dependencies);
  state.layout.settings = dependencies.loadSettings();
  return { start: dependencies.start, services: dependencies, state };
}
