import * as ThreeCore from './three.module.js';
import { GLTFLoader } from './addons/loaders/GLTFLoader.js';
import { HDRLoader } from './addons/loaders/HDRLoader.js';

globalThis.THREE = { ...ThreeCore, GLTFLoader, HDRLoader };
