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
import * as editor from "../editor.js";
import * as exporter from "../exporter.js";
import {setError} from "../error.js";

class FsManager {
    constructor(workerApi) {
        this.workerApi = workerApi;
        this.sw = null;
        this.defProjectName = 'jscad';
        this.filesToCheck = [];
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
        await this.checkFS();
        if (files.includes('/package.json')) {
            await this.reloadProject();
        } else {
            this.workerApi.jscadClearFileCache({files, root: this.sw.base});
            await editor.filesChanged(files);
            if (this.sw.fileToRun) this.workerApi.jscadScript({url: this.sw.fileToRun, base: this.sw.base});
        }
    }

    async resetFileRefs() {
        await this.checkFS();
        editor.setFiles([]);
        this.sw.cache = {};
        if (this.sw) {
            delete this.sw.fileToRun;
            await clearFs(this.sw);
        }
    }

    async checkFS() {
        if (!this.sw) {
            await this.initFs();
        }
    }

    async reloadProject() {
        await this.checkFS();
        this.workerApi.jscadClearTempCache();
        clearCache(this.sw.cache);
        this.cache = {};
        this.filesToCheck = [];
        const {alias, script} = await analyzeProject(this.sw);
        exporter.exportConfig.projectName = this.sw.projectName;
        if (alias.length) this.workerApi.jscadInit({alias});
        let url = this.sw.fileToRun;
        if (this.sw.fileToRun?.endsWith('.jscad')) {
            const modifiedScript = addV1Shim(script);
            addToCache(this.sw.cache, this.sw.fileToRun, modifiedScript);
        }
        await this.workerApi.jscadScript({url, base: this.sw.base});
        editor.setSource(script, url);
        editor.setFiles(this.filesToCheck);
    }

    getFile(path) {
        return getFile(path, this.sw);
    }

    filename(file) {
        return file.path + "/" + file.filename;
    }

    async setFileTree(files = []) {
        await this.checkFS();
        try {
            if (this.sw.cache) {
                await clearCache(this.sw.cache)
                for (const f of files) {
                    await addToCache(this.sw.cache, this.filename(f), f.fileContent)
                }
                editor.setFiles(files.map(f => {
                    return {
                        name: f.filename,
                        fullPath: this.filename(f),
                        isFile: true,
                        source: f.fileContent
                    }
                }));

                editor.setSource(files[0].fileContent, this.filename(files[0]));
            }
        } catch (e) {
            setError(e)
        }
    }
}

export default FsManager;
