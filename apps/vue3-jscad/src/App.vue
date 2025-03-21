<template>
  <div class="container">
    <div class="layout" id="layout">
      <div id="root">
        <div id="viewer"></div>
      </div>

      <div id="overlay">
        <div class="above-error">
          <div id="spinner" title="Processing..."></div>

          <div id="model-options">
            <div id="paramsDiv"></div>
            <div class="export-panel">
              <select id="export-format"></select>
              <button id="export-button">Export</button>
            </div>
          </div>
        </div>

        <div id="error-bar">
          <label id="error-name">Error:</label>
          <span id="error-message"></span>
        </div>
      </div>
    </div>

    <div id="editor">
      <div id="editor-drawer">
        <nav id="editor-nav">
          <button id="editor-file"></button>
          <ul id="editor-files"></ul>
        </nav>
        <div id="editor-container"></div>
        <a id="editor-hint">Shift-enter to update</a>
      </div>
      <div id="editor-toggle"></div>
    </div>

    <div id="menu">
      <button id="menu-button">JSCAD</button>
      <div id="menu-content">
        <h2>Options</h2>
        <ul>
          <li><label for="dark-mode">Dark Mode</label><input type="checkbox" id="dark-mode"></li>
          <li><label for="show-axis">Show Axis</label><input type="checkbox" id="show-axis" checked></li>
          <li><label for="show-grid">Show Grid</label><input type="checkbox" id="show-grid" checked></li>
        </ul>

        <h2>Documentation</h2>
        <ul>
          <li><a href="https://openjscad.xyz/dokuwiki/doku.php" target="_blank">User Guide</a></li>
          <li><a href="/docs/" target="_blank">API Reference</a></li>
          <li><a href="https://github.com/jscad/OpenJSCAD.org/issues" target="_blank">GitHub Issues</a></li>
          <li><a href="https://openjscad.nodebb.com/" target="_blank">User Group</a></li>
          <li><a href="https://discord.gg/6PB7qZ4HC7" target="_blank">Discord Community</a></li>
        </ul>

        <h2>Examples</h2>
        <ul id="examples"></ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';

import { addToCache, extractEntries, fileDropped, getFile, registerServiceWorker } from '@jscadui/fs-provider';
import { Gizmo } from '@jscadui/html-gizmo'
import { OrbitControl } from '@jscadui/orbit';
import { genParams } from '@jscadui/params';
import { messageProxy } from '@jscadui/postmessage';

import * as editor from './jscad/editor.js'
import * as engine from './jscad/engine.js'
import * as exporter from './jscad/exporter.js'
import * as menu from './jscad/menu.js'
import * as remote from './jscad/remote.js'
import { ViewState } from './jscad/viewState.js';

/** @typedef {import('@jscadui/worker').JscadWorker} JscadWorker*/

const defaultCode = `import * as jscad from '@jscad/modeling'
const { intersect, subtract } = jscad.booleans
const { colorize } = jscad.colors
const { cube, sphere } = jscad.primitives

export const main = () => {
  const outer = subtract(
    cube({ size: 10 }),
    sphere({ radius: 6.8 })
  )
  const inner = intersect(
    sphere({ radius: 4 }),
    cube({ size: 7 })
  )
  return [
    colorize([0.65, 0.25, 0.8], outer),
    colorize([0.7, 0.7, 0.1], inner),
  ]
}
`

const gizmo = ref(null);
const ctrl = ref(null);
const viewState = ref(null);
let serviceWorker = ref(null);
const byId = id => document.getElementById(id);
const spinner = ref(null);
const appBase = document.baseURI
let currentBase = appBase
const toUrl = path => new URL(path, appBase).toString()
let projectName = 'jscad'
let model = []
let loadDefault = true

onMounted(async () => {
  viewState.value = new ViewState();

  // Initialize Gizmo
  gizmo.value = new Gizmo();
  document.getElementById('overlay').parentNode.appendChild(gizmo.value);


  // Initialize OrbitControl
  console.log(document.getElementById('viewer'))
  ctrl.value = new OrbitControl([document.getElementById('viewer')], { ...viewState.value.camera, alwaysRotate: false });
  
  const updateFromCtrl = change => {
  const { position, target, rx, rz, len, ...rest } = change
    viewState.value.setCamera({ position, target })
    gizmo.value.rotateXZ(rx, rz)
  }
  updateFromCtrl(ctrl)
  
  ctrl.value.onchange = state => viewState.value.saveCamera(state);
  ctrl.value.oninput = state => updateFromCtrl(state);

  updateFromCtrl(ctrl.value)
  
  // Initialize Service Worker
  try {
    serviceWorker.value = await registerServiceWorker('bundle.fs-serviceworker.js?prefix=/swfs/', (path) => {
      return getFile(path, serviceWorker.value);
    });
    serviceWorker.value.defProjectName = 'jscad';
  } catch (error) {
    console.error('Service Worker initialization failed:', error);
  }

  // Initialize engine
  await engine.init().then(viewer => {
    viewState.value.setEngine(viewer);
  });

  spinner.value = byId('spinner');
  editor.init(defaultCode, async (script, path) => {
    const sw = serviceWorker.value
    if (sw && sw.fileToRun) {
      await addToCache(sw.cache, path, script)
      await workerApi.jscadClearFileCache({ files: [path] })
      if (sw.fileToRun) jscadScript({ url: sw.fileToRun, base: sw.base })
    } else {
      jscadScript({ script })
    }
  })

  menu.init(loadExample);
  remote.init((script) => {
    // run remote script
    editor.setSource(script)
    jscadScript({ script })
  }, (err) => {
    // show remote script error
    loadDefault = false
    setError(err)
  })
  exporter.init(exportModel)

  jscadScript({ script: defaultCode })
});

const loadExample = source => {
  editor.setSource(source)
  jscadScript({ script: source })
}

const exportModel = async (format, extension) => {
  const { data } = (await workerApi.exportData({ format })) || {}
  if (data) {
    save(new Blob([data], { type: 'text/plain' }), `${projectName}.${extension}`)
    console.log('save', `${projectName}.${extension}`, data)
  }
}

function setError(err){
  if(err) console.warn(err)
}

let working = ref(false);
let lastParams = ref(null);

const paramChangeCallback = async (params) => {
  if (!working.value) {
    lastParams.value = null;
  } else {
    lastParams.value = params;
    return;
  }
  working.value = true;
  let result;
  try {
    result = await workerApi.jscadMain({ params });
  } finally {
    working.value = false;
  }
  handlers.entities(result);
  if (lastParams.value && lastParams.value != params) paramChangeCallback(lastParams.value);
};

watch(lastParams, (newParams) => {
  paramChangeCallback(newParams);
});

const jscadScript = async ({ script, url = './index.js', base, root }) => {
  const result = await workerApi.jscadScript({ script, url, base, root })
  loadDefault = false // don't load default model if something else was loaded
  console.log('jscadScript', result)
  genParams({ target: byId('paramsDiv'), params: result.def || {}, callback: paramChangeCallback })
  handlers.entities(result)
}

const worker = new Worker('./build/bundle.worker.js')
const handlers = {
  entities: ({ entities }) => {
    if (!(entities instanceof Array)) entities = [entities]
    viewState.value.setModel((model = entities))
    setError(undefined)
  },
}
/** @type {JscadWorker} */
const workerApi = globalThis.workerApi = messageProxy(worker, handlers, { onJobCount: trackJobs })

let jobs = 0;
let firstJobTimer = null;
function trackJobs(jobs) {
  if (jobs === 1) {
    // do not show progress for fast renders
    clearTimeout(firstJobTimer)    
    firstJobTimer = setTimeout(() => {
      onProgress()
      progress.style.display = 'block'
    }, 300)
  }
  if (jobs === 0) {
    clearTimeout(firstJobTimer)
    progress.style.display = 'none'
  }
}

workerApi.jscadInit({
  bundles: {// local bundled alias for common libs.
    '@jscad/modeling': toUrl('./build/bundle.jscad_modeling.js'),
    '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
  },
}).then(() => {
  if (loadDefault) {
    jscadScript({ script: defaultCode })
  }
})

</script>


<style lang="scss" >
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body,
html {
  width: 100%;
  height: 100%;
}

body {
  font-family: "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  background-color: #fbfbfb;
  color: #333;
  overflow: hidden;
  display: flex;
  justify-content: stretch;
  align-items: stretch;
}

body.dark {
  background-color: #282828;
  color: #ccc;
}


.layout {
  flex: 1;
  display: flex;
  min-width: 80px;
  background-color: #fcfcfc;
  position: relative;
}

.dark .layout {
  background-color: #333;
}

#root {
  flex: 1;
  display: grid;
}

#root canvas {
  position: absolute;
  top: 0;
  left: 0;
}

#overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}

#overlay .above-error * {
  pointer-events: auto;
}

#dropModal {
  display: none;
  position: fixed;
  padding: 5px;
  text-align: center;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 5000;
}

jscadui-gizmo {
  position: absolute;
  top: 15px;
  right: 15px;
  --cube-size: 100px;
  --cube-line-color: #f2f2f2dd;
  /*  --cube-corner-radius: 5px;*/
}

.dark jscadui-gizmo {
  --cube-line-color: #333333dd;
  --cube-bg: #111;
  --cube-fg: #999;
  --cube-bg-hover: #555560;
  --cube-fg-hover: #ccc;
}

a {
  color: #08d;
  text-decoration: none;
  cursor: pointer;
}

.dark a {
  color: #19d;
}

a:active,
a:focus,
a:hover {
  color: #06a;
}

.dark a:active,
.dark a:focus,
.dark a:hover {
  color: #6be;
}

.dark a:focus-visible {
  outline: 1px solid #eee;
}

button,
select {
  padding: 4px 6px;
  border: 1px solid #888;
  border-radius: 2px;
  background-color: #fdfdfd;
  font-size: 12pt;
  color: #222;
  cursor: pointer;
}

button:hover,
select:hover {
  background-color: #f6f6f6;
}

h1 {
  margin-bottom: 10px;
}

h2 {
  font-weight: normal;
  font-size: 16pt;
}

input {
  border: 1px solid #999;
  border-radius: 3px;
  padding: 2px 4px;
  transition: border 0.3s;
}

input:focus {
  outline: none;
  border: 1px solid #555;
}

input[type="checkbox"],
input[type="color"],
input[type="radio"],
input[type="range"] {
  margin: 0 5px;
  cursor: pointer;
}

p {
  margin-bottom: 10px;
}

.container {
  position: absolute;
  height: 100%;
  width: 100%;
  left: 0;
  top: 0;
  display: flex;
  align-items: stretch;
}

#viewer {
  position: relative;
  overflow: hidden;
  touch-action: none;
}

/* editor style */
#editor {
  position: relative;
  width: 400px;
  max-width: calc(100vw - 80px);
}

#editor.transition {
  transition: width 0.5s;
}

#editor.closed {
  width: 0px !important;
}

#editor-drawer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

#editor-container {
  width: 100%;
  height: calc(100vh - 60px);
  flex: 1;
}

#editor-hint {
  position: absolute;
  bottom: 10px;
  right: calc(min(10px, 100% - 180px));
  /* push right when editor is small */
  color: #66666688;
  white-space: nowrap;
  font-size: 10pt;
  user-select: none;
}

.dark #editor-hint {
  color: #dddddd88;
}

/* editor file navigation */
#editor-nav {
  display: none;
  position: relative;
  margin-right: 1px;
  margin-bottom: 1px;
}

#editor-nav.visible {
  display: block;
}

#editor-nav button {
  border-radius: 0;
  color: #444;
  font-family: monospace;
  font-size: 8pt;
  outline-offset: -1px;
  padding: 4px 10px;
  text-align: left;
  display: block;
  width: 100%;
}

#editor-nav button:focus {
  outline: 1px solid #888;
  background-color: #f6f6f9;
}

#editor-file {
  width: 100%;
  border: 1px solid #bbb;
}

#editor-file::after {
  content: "▼";
  position: absolute;
  right: 6px;
  display: inline-block;
  vertical-align: middle;
  pointer-events: none;
}

#editor-nav.open #editor-file {
  border: 1px solid #888;
}

#editor-files {
  position: absolute;
  width: 100%;
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  display: none;
  border: 1px solid #888;
  border-top: none;
  box-shadow: 0 10px 10px -5px rgba(0, 0, 0, 0.25);
  z-index: 1000;
  list-style: none;
}

#editor-nav.open #editor-files {
  display: block;
}

#editor-files button {
  border: none;
  outline-offset: 0;
}

#editor-files button:focus {
  background-color: #f6f6f9;
}

.dark #editor-nav button {
  background-color: #333;
  color: #bbb;
}

.dark #editor-nav button:focus {
  outline: 1px solid #aaa;
}

.dark #editor-nav button:hover {
  background-color: #444450;
}

.dark #editor-files button:focus {
  background-color: #444450;
}

.dark #editor-file {
  border: 1px solid #666;
}

#editor-toggle {
  background-color: #ebf;
  position: absolute;
  width: 16px;
  height: 90px;
  left: -16px;
  top: 50%;
  margin-top: -45px;
  border-top: 1px solid #444;
  border-left: 1px solid #444;
  border-bottom: 1px solid #444;
  border-top-left-radius: 10px;
  border-bottom-left-radius: 10px;
  padding: 5px;
  display: flex;
  cursor: col-resize;
  touch-action: none;
}

.dark #editor-toggle {
  background-color: #657;
}

#editor-toggle::after {
  content: "\27E9";
  display: flex;
  align-items: center;
}

.closed #editor-toggle::after {
  content: "\27E8";
}

.cm-editor {
  height: 100%;
}

.cm-gutters {
  border-right: none !important;
  user-select: none;
}

/* highlight focus using gutters not outline */
.cm-focused {
  outline: none !important;
}

.ͼ2 .cm-activeLine {
  background-color: #eeeeee88;
}

.cm-focused .cm-activeLine {
  background-color: #cceeff44;
}

.dark .cm-focused .cm-gutters,
.dark .cm-focused .cm-activeLine {
  background-color: #7777bb44;
}

.dark .cm-gutters,
.dark .cm-activeLine {
  background-color: #5e5e6e66;
  color: #aaa;
}

.dark .cm-activeLineGutter {
  background-color: #667;
}

.dark .cm-cursor {
  border-left-color: #ddd;
}

.dark .cm-selectionBackground {
  background-color: #666677bb !important;
}

/* code theme */
/* keyword */
.dark .ͼb {
  color: #c8d;
}

/* numeric */
.dark .ͼd {
  color: #bbc281;
}

/* strings */
.dark .ͼe {
  color: #e48f7f;
}

/* vars */
.dark .ͼg {
  color: #3af;
}

/* key */
.dark .ͼl {
  color: #87ceff;
}

/* comment */
.dark .ͼm {
  color: #5ba25b;
}

/* menu style */
#menu {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3000;
  max-height: calc(100vh - 70px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

#menu-button {
  border: none;
  padding: 2px 4px;
  background-color: transparent;
}

#menu-button:hover {
  color: #111;
}

.dark #menu-button {
  color: #ddd;
}

.dark #menu-button:hover {
  color: #eee;
}

#menu-button::after {
  padding-left: 5px;
  content: "\25bc";
}

.open #menu-button::after {
  content: "\25b2";
}

#menu-content {
  display: none;
  padding: 10px;
  border: 1px solid #888;
  background-color: #f8f8f8;
  overflow-y: auto;
  box-shadow: 0 5px 10px -5px rgba(0, 0, 0, 0.25);
}

.dark #menu-content {
  background-color: #444;
  border: 1px solid #555;
}

.open #menu-content {
  display: block;
}

#menu-content h2 {
  border-bottom: 1px solid #111;
  margin-bottom: 5px;
  padding-right: 30px;
}

.dark #menu-content h2 {
  border-bottom: 1px solid #999;
}

#menu-content ul {
  margin-bottom: 10px;
  list-style-type: none;
}

#menu-content li {
  display: flex;
  padding-left: 5px;
  margin-bottom: 1px;
}

#menu-content label {
  flex: 1;
  cursor: pointer;
  user-select: none;
}

#model-options {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid #aaaaaa88;
  border-radius: 5px;
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 2000;
  max-height: calc(100% - 50px);
  overflow-y: auto;
}

.dark #model-options {
  background: rgba(40, 40, 40, 0.5);
  border: 1px solid #33333344;
}

#paramsDiv {
  overflow: auto;
  display: flex;
  flex-direction: column;
}

#paramsDiv>.form-line:first-child {
  margin-top: 5px;
}

#paramsDiv button {
  margin-right: 2px;
}

#paramsDiv select {
  font-size: 10pt;
  padding: 2px 4px;
}

#paramsDiv .form-line {
  min-width: 260px;
  display: flex;
  margin: 2px 10px;
}

#paramsDiv .form-line>label {
  display: inline-block;
  min-width: 100px;
  flex: 1;
  margin-right: 5px;
}

#paramsDiv .form-line i {
  display: none;
}

#paramsDiv .form-line[type="color"] i,
#paramsDiv .form-line[type="range"] i,
#paramsDiv .form-line[type="slider"] i {
  display: inline-block;
  padding: 0 5px;
  margin-left: 5px;
  border: solid 1px #eee;
}

.dark #paramsDiv .form-line[type="color"] i,
.dark #paramsDiv .form-line[type="range"] i,
.dark #paramsDiv .form-line[type="slider"] i {
  border: solid 1px #666;
}

/* groups */
#paramsDiv .form-line[type="group"] {
  position: relative;
  background: linear-gradient(180deg, #00000014, transparent);
  padding: 5px 10px;
  margin: 10px 0 0 0;
}

#paramsDiv .form-line[type="group"]:first-child {
  margin-top: 0;
}

#paramsDiv .form-line[type="group"]:before {
  content: "\25bc";
  padding-right: 10px;
  padding-top: 3px;
  cursor: pointer;
}

#paramsDiv .form-line[type="group"][closed="1"]:before {
  content: "\25ba";
}

#paramsDiv .form-line[type="group"] label {
  font-weight: 500;
  font-size: 1.2em;
  cursor: pointer;
}

#paramsDiv .form-line[type="group"]:hover {
  color: #222;
}

.dark #paramsDiv .form-line[type="group"]:hover {
  color: #ddd;
}

#paramsDiv .form-line[closed="1"]:not([type="group"]) {
  display: none;
}

#paramsDiv .form-line input[type="number"] {
  width: 60px;
}

#paramsDiv .form-line input[type="range"] {
  flex: 1;
}

#paramsDiv .form-line input[type="date"] {
  cursor: text;
}

#paramsDiv .form-line [type="radio"] label {
  cursor: pointer;
}

#paramsDiv .jscad-param-buttons {
  display: none;
}

.export-panel {
  margin: 5px;
  display: flex;
  align-items: stretch;
}

.export-panel button,
.export-panel select {
  border-radius: 0;
}

.export-panel button {
  border-bottom-right-radius: 4px;
  border-top-right-radius: 4px;
}

.export-panel select {
  border-bottom-left-radius: 4px;
  border-top-left-radius: 4px;
}

#spinner {
  position: absolute;
  bottom: 10px;
  right: 10px;
  border: 6px solid #f3f3f3;
  border-top: 6px solid #27c;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  animation: spin 1s linear infinite;
  display: none;
}

.dark #spinner {
  border: 6px solid #222;
  border-top: 6px solid #16a;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.above-error {
  flex: 1;
  position: relative;
}

#error-bar {
  width: 100%;
  max-height: 0;
  padding: 0;
  background-color: #dd111199;
  font-family: monospace;
  overflow-y: auto;
  transition: max-height 0.4s;
  pointer-events: all;
}

#error-bar.visible {
  max-height: 40%;
  padding: 10px;
}

#error-bar label {
  font-weight: bold;
}

#error-message {
  white-space: pre;
}

#welcome {
  position: absolute;
  top: 20%;
  padding: 30px;
  border-radius: 10px;
  background-color: rgba(240, 240, 240, 0.8);
  backdrop-filter: blur(10px);
  z-index: 4000;
}

#welcome ul li {
  margin-left: 20px;
}

.welcome-dismiss {
  float: right;
  cursor: pointer;
  color: #555;
  user-select: none;
}

.welcome-dismiss input {
  cursor: pointer;
}

.dark #welcome {
  background-color: rgba(30, 30, 30, 0.8);
}

.dark .welcome-dismiss {
  color: #888;
}

@media (min-width: 768px) {
  #welcome {
    width: 500px;
    margin-left: -250px;
    left: calc(50% - 200px);
  }
}

/* Mobile */
@media (max-height: 480px) {
  #welcome {
    top: 20px;
    bottom: 20px;
    overflow-y: auto;
  }
}

@media (max-width: 767px) {
  #welcome {
    width: 90%;
    left: 5%;
  }

  #editor {
    width: 0;
  }

  jscadui-gizmo {
    --cube-size: 70px;
  }
}
</style>

