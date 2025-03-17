import {
    addToCache,
    analyzeProject,
    clearCache,
    clearFs,
    getFile,
    getFileContent,
    registerServiceWorker,
} from '@jscadui/fs-provider';
import {addV1Shim} from '../addV1Shim.js';

class FsManager {
    constructor(workerApi) {
        this.workerApi = workerApi;
        this.sw = null;
        this.defProjectName = 'jscad';
        this.filesToCheck = [];
        this.cache = {};
        this.fileToRun = null;
    }

    async initFs() {
        const getFileWrapper = (path, sw) => getFileContent(path, sw).then(() => editor.setFiles(sw.filesToCheck));
        const scope = document.location.pathname;
        try {
            this.sw = await registerServiceWorker(`bundle.fs-serviceworker.js?prefix=${scope}swfs/`, getFileWrapper, {
                scope,
                prefix: scope + 'swfs/',
            });
            this.sw.defProjectName = 'jscad';
            this.sw.onfileschange = this.onFilesChange.bind(this);
            this.sw.getFile = path => getFile(path, this.sw);
        } catch (e) {
            const lastReload = localStorage.getItem('lastReload');
            if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
                localStorage.setItem('lastReload', Date.now().toString());
                //location.reload();
            }
        }
    }

    async onFilesChange(files) {
        if (files.includes('/package.json')) {
            await this.reloadProject();
        } else {
            this.workerApi.jscadClearFileCache({files, root: this.sw.base});
            await editor.filesChanged(files);
            if (this.sw.fileToRun) this.workerApi.jscadScript({url: this.sw.fileToRun, base: this.sw.base});
        }
    }

    async resetFileRefs() {
        editor.setFiles([]);
        this.cache = {};
        if (this.sw) {
            delete this.sw.fileToRun;
            await clearFs(this.sw);
        }
    }

    async reloadProject() {
        this.workerApi.jscadClearTempCache();
        clearCache(this.cache);
        this.cache = {};
        this.filesToCheck = [];
        const {alias, script} = await analyzeProject(this.sw);
        exporter.exportConfig.projectName = this.sw.projectName;
        if (alias.length) this.workerApi.jscadInit({alias});
        let url = this.sw.fileToRun;
        if (this.sw.fileToRun?.endsWith('.jscad')) {
            const modifiedScript = addV1Shim(script);
            addToCache(this.cache, this.sw.fileToRun, modifiedScript);
        }
        await this.workerApi.jscadScript({url, base: this.sw.base});
        editor.setSource(script, url);
        editor.setFiles(this.filesToCheck);
    }

    getFile(path) {
        return getFile(path, this.sw);
    }
}

export default FsManager;
