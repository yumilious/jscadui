class ProgressBar {
    constructor(progressId, progressTextId) {
        this.progress = document.getElementById(progressId).querySelector('progress');
        this.progressText = document.getElementById(progressTextId);
    }

    setProgress(value, note) {
        if (value === undefined) {
            this.progress.removeAttribute('value');
        } else {
            this.progress.value = value;
        }
        this.progressText.innerText = note ?? '';
    }
}

export default ProgressBar;
