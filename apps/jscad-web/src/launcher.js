import FsManager from './managers/fsManager.js';
import ParameterManager from './managers/parameterManager.js';
import ProgressBar from './managers/progressBar.js';
import DragAndDropHandler from './managers/dragAndDropHandler.js';
import {messageProxy} from '@jscadui/postmessage';
import * as engine from './engine.js';
import * as editor from './editor.js';
import * as exporter from './exporter.js';
import * as menu from './menu.js';
import * as remote from './remote.js';
import {setError} from './error.js';
import {ViewState} from './viewState.js';
import {OrbitControl} from '@jscadui/orbit';
import {Gizmo} from '@jscadui/html-gizmo';
import * as welcome from './welcome.js'

class Launcher {
    /**
     * Constructor of the Launcher class.
     * @param {Object} options - Configuration options for the launcher.
     * @param {string} options.viewer - ID of the viewer element.
     */
    constructor(options = {viewer: "viewer"}) {
        this.appBase = document.baseURI;
        this.currentBase = this.appBase;
        this.viewState = new ViewState();
        this.loadDefault = true;
        this.hasRemoteScript = false;
        this.saveMap = {};
        this.ctrl = new OrbitControl([document.getElementById(options.viewer)], {...this.viewState.camera});
        this.gizmo = new Gizmo();

        document.getElementById('layout').appendChild(this.gizmo);
        this.progressBar = new ProgressBar('progress', 'progressText');

        this.worker = new Worker('./build/bundle.worker.js');
        this.workerApi = messageProxy(this.worker, this.handlers.bind(this), {onJobCount: this.trackJobs.bind(this)});

        this.ctrl.onchange = (state) => this.viewState.saveCamera(state);
        this.ctrl.oninput = (state) => this.updateFromCtrl(state);
        this.gizmo.onRotationRequested = (cam) => this.ctrl.animateToCommonCamera(cam);

        this.fsManager = new FsManager(this.workerApi);
        this.paramManager = new ParameterManager(this.workerApi, 'paramsDiv', this.handlers.bind(this));
        this.dragAndDropHandler = new DragAndDropHandler(this.fsManager, this.reloadProject.bind(this));
    }

    /**
     * Returns an element by its ID.
     * @param {string} id - The ID of the element to be retrieved.
     * @returns {HTMLElement} - The element with the specified ID.
     */
    byId(id) {
        return document.getElementById(id);
    }

    /**
     * Reloads the current project.
     */
    async reloadProject() {
        await this.fsManager.reloadProject();
        await this.paramManager.updateParamsUI([], {});
        this.viewState.zoomToFit = true;
        this.viewState.setModel([]);
    }

    /**
     * Executes a JSCAD script.
     * @param {Object} config - Configuration for the JSCAD script execution.
     * @param {string} config.script - The JSCAD script content.
     * @param {string} [config.url=./jscad.model.js] - The URL of the script.
     * @param {string} [config.base=this.currentBase] - The base URL for the script.
     * @param {Object} [config.root] - The root context for the script.
     */
    async jscadScript({script, url = './jscad.model.js', base = this.currentBase, root}) {
        this.currentBase = base;
        this.loadDefault = false;
        try {
            const result = await this.workerApi.jscadScript({script, url, base, root});
            this.updateParametersUI(result);
            this.handlers().entities(result);
            this.startAutoAnimations(result.def);
        } catch (err) {
            setError(err);
        }
    }

    /**
     * Updates the Parameters UI based on the script execution result.
     * @param {Object} result - The result of the JSCAD script execution.
     * @param {Array} result.def - Default parameters.
     * @param {Object} result.params - Parameters object.
     */
    async updateParametersUI(result) {
        const defParams = result.def || [];
        const params = result.params;

        // Update the Parameters UI with the retrieved parameters.
        await this.paramManager.updateParamsUI(defParams, params);
    }

    /**
     * Starts any defined animations based on the default parameters.
     * @param {Array} defParams - Default parameters from the script.
     */
    startAutoAnimations(defParams) {
        // Check for default parameters that require an auto-start animation.
        defParams && defParams.forEach(def => {
            if (def.type === "slider" && def.fps && def.autostart) {
                const value = this.paramManager.lastRunParams[def.name] || 0;
                // Start the animation callback for the parameter.
                this.paramManager.startAnimCallback(def, value);
            }
        });
    }

    /**
     * Updates the view state from the OrbitControl.
     * @param {Object} change - The state change from the OrbitControl.
     * @param {Array} change.position - The position of the camera.
     * @param {Array} change.target - The target of the camera.
     * @param {number} change.rx - Rotation along the X-axis.
     * @param {number} change.rz - Rotation along the Z-axis.
     */
    updateFromCtrl(change) {
        const {position, target, rx, rz} = change;
        this.viewState.setCamera({position, target});
        this.gizmo.rotateXZ(rx, rz);
    }

    /**
     * Tracks the number of ongoing jobs and updates the progress bar accordingly.
     * @param {number} jobs - The number of ongoing jobs.
     */
    trackJobs(jobs) {
        if (jobs === 1) {
            clearTimeout(this.firstJobTimer);
            this.firstJobTimer = setTimeout(() => {
                this.showProgressBar();
            }, 300);
        }
        if (jobs === 0) {
            clearTimeout(this.firstJobTimer);
            this.hideProgressBar();
        }
    }

    /**
     * Shows the progress bar.
     */
    showProgressBar() {
        this.progressBar.progress.style.display = 'block';
    }

    /**
     * Hides the progress bar.
     */
    hideProgressBar() {
        this.progressBar.progress.style.display = 'none';
    }

    /**
     * Initializes handlers for various events.
     * @returns {Object} - An object containing event handlers.
     */
    handlers() {
        const viewState = this.viewState;
        const progressBar = this.progressBar;
        return {
            entities: this.handleEntities.bind(this, viewState, progressBar),
            onProgress: progressBar.setProgress.bind(progressBar),
        };
    }

    /**
     * Handles the result of JSCAD script execution.
     * @param {ViewState} viewState - The ViewState instance.
     * @param {ProgressBar} progressBar - The ProgressBar instance.
     * @param {Object} result - The result of the JSCAD script execution.
     * @param {Object} [options={}] - Additional options.
     * @param {boolean} [options.skipLog=false] - Whether to skip logging.
     */
    handleEntities(viewState, progressBar, result, {skipLog} = {}) {
        if (!(result.entities instanceof Array)) result.entities = [result.entities];

        // Set the model for the view state.
        viewState.setModel(result.entities);

        // Fit the view to the model if zoomToFit is enabled.
        if (viewState.zoomToFit) {
            const {min, max} = boundingBox(result.entities);
            const {fov, aspect} = viewState.viewer.getCamera();
            this.ctrl.fit(min, max, fov, aspect, 1.2);
        }

        // Log the execution times.
        if (!skipLog) console.log('Main execution:', result.mainTime?.toFixed(2), ', jscad mesh -> gl:', result.convertTime?.toFixed(2), result.entities);

        // Clear any previous error and update the progress bar.
        setError(undefined);
        progressBar.setProgress(undefined, result.mainTime?.toFixed(2) + ' ms');
    }

    /**
     * Initializes the 3D engine.
     */
    async initEngine() {
        const threeEngine = await engine.init();
        // Set the 3D engine for the view state.
        this.viewState.setEngine(threeEngine);
    }

    /**
     * Initializes the editor with default code.
     * @param {string} defaultCode - The default script code to be loaded into the editor.
     */
    async initEditor(defaultCode) {
        editor.init(
            defaultCode,
            this.executeEditorScript.bind(this),
            this.saveEditorScript.bind(this),
            this.fsManager.getFile.bind(this.fsManager)
        );
    }

    /**
     * Executes a script loaded from the editor.
     * @param {string} script - The script content.
     * @param {string} path - The file path for the script.
     */
    async executeEditorScript(script, path) {
        if (this.fsManager.sw && this.fsManager.sw.fileToRun) {
            await this.cacheEditorScript(path, script);
            await this.workerApi.jscadClearFileCache({files: [path], root: this.fsManager.sw.base});
            if (this.fsManager.sw.fileToRun)
                await this.jscadScript({
                    url: this.fsManager.sw.fileToRun,
                    base: this.fsManager.sw.base
                });
        } else {
            await this.jscadScript({script});
        }
    }

    /**
     * Saves a script from the editor to a file.
     * @param {string} script - The script content to be saved.
     * @param {string} path - The file path.
     */
    async saveEditorScript(script, path) {
        const pathArr = path.split('/');
        let fileHandle = (await this.fsManager.getFile(path))?.handle || this.saveMap[path];

        if (!fileHandle) {
            const opts = {
                suggestedName: pathArr[pathArr.length - 1],
                excludeAcceptAllOption: true,
                types: [
                    {description: 'Javascript', accept: {'application/javascript': ['.js']}},],
            };
            fileHandle = await globalThis.showSaveFilePicker?.(opts);
        }

        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(script);
            await writable.close();
            this.saveMap[path] = fileHandle;
            fileHandle.lastMod = Date.now() + 500;
        }
    }

    /**
     * Initializes the application menu.
     */
    initMenu() {
        menu.init();
    }

    /**
     * Initializes the welcome screen.
     */
    initWelcome() {
        welcome.init();
    }

    /**
     * Initializes a remote script, if any.
     */
    async initRemoteScript() {
        try {
            this.hasRemoteScript = await remote.init(
                this.openRemoteScript.bind(this),
                this.handleRemoteScriptError.bind(this),
            );
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Opens and executes a remote script.
     * @param {string} script - The script content.
     * @param {string} url - The URL of the script.
     */
    async openRemoteScript(script, url) {
        url = new URL(url, this.appBase).toString();
        editor.setSource(script, url);
        await this.jscadScript({script, base: url});
        welcome.dismiss();
    }

    /**
     * Handles errors encountered during remote script initialization.
     * @param {Error} err - The error encountered.
     */
    handleRemoteScriptError(err) {
        this.loadDefault = false;
        setError(err);
        welcome.dismiss();
    }

    /**
     * Initializes the exporter.
     */
    async initExporter() {
        exporter.init(this.workerApi);
    }

    /**
     * Checks for changes in saved files and updates the editor accordingly.
     */
    async checkFileChanges() {
        // Check each file in the save map for changes.
        for (const p of Object.keys(this.saveMap)) {
            const handle = this.saveMap[p];
            const file = await handle.getFile();
            if (file.lastModified > handle.lastMod) {
                handle.lastMod = file.lastModified;
                await editor.filesChanged([file]);
                editor.runScript();
            }
        }
    }

    /**
     * Caches an editor script in the file system.
     * @param {string} path - The file path.
     * @param {string} script - The script content.
     */
    async cacheEditorScript(path, script) {
        await addToCache(this.fsManager.sw.cache, path, script);
    }
}

export default Launcher;
