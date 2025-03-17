import {fileDropped, extractEntries} from '@jscadui/fs-provider';
import {setError} from "../error.js";

class DragAndDropHandler {
    constructor(fsManager, reloadProject, dropModel = "dropModal") {
        this.fsManager = fsManager;
        this.reloadProject = reloadProject;
        this.dropModelView = document.getElementById(dropModel);
        document.body.addEventListener('drop', this.handleFileDrop.bind(this));
        document.body.addEventListener('dragover', this.handleDragOver.bind(this));
        document.body.addEventListener('dragend', this.dragEndOrLeave.bind(this));
        document.body.addEventListener('dragleave', this.dragEndOrLeave.bind(this));
    }

    async handleFileDrop(ev) {
        try {
            ev.preventDefault();
            if (!ev.dataTransfer) return;
            const files = await extractEntries(ev.dataTransfer);
            if (!files.length) return;
            await this.fsManager.resetFileRefs();
            if (!this.fsManager.sw) await this.fsManager.initFs();
            await fileDropped(this.fsManager.sw, files);
            await this.reloadProject();
        } catch (error) {
            setError(error);
            console.error(error);
        }
    }

    handleDragOver(ev) {
        ev.preventDefault();
        this.showDrop(true);
    }

    showDrop(show) {
        clearTimeout(this.showDropTimer);
        this.dropModelView.style.display = show ? 'initial' : 'none';
    }

    dragEndOrLeave() {
        clearTimeout(this.showDropTimer);
        this.showDropTimer = setTimeout(() => this.showDrop(false), 300);
    }
}

export default DragAndDropHandler;
