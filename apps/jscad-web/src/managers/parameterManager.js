import {AnimRunner} from '../animRunner.js';
import {genParams, getParams} from "@jscadui/params";

class ParameterManager {
    constructor(workerApi, targetId, handlers) {
        this.workerApi = workerApi;
        this.target = document.getElementById(targetId);
        this.setValue = null;
        this.animStatus = null;
        this.lastRunParams = null;
        this.currentAnim = null;
        this.handlers = handlers;

        this.handleEntities = (result, paramValues, times) => {
            this.lastRunParams = paramValues;
            this.setValue(times || {}, true);
            this.progressBar.setProgress(result)
        };
    }

    async updateParamsUI(def, params) {
        const tmp = genParams({
            target: this.target,
            params: def,
            callback: this.paramChangeCallback.bind(this),
            pauseAnim: this.pauseAnimCallback.bind(this),
            startAnim: this.startAnimCallback.bind(this)
        });
        this.setValue = tmp.setValue;
        this.animStatus = tmp.animStatus;
        this.lastRunParams = params;
    }

    async paramChangeCallback(params, source) {
        if (source === 'group') return;

        this.stopCurrentAnim();
        let {lastParams, lastRunParams, working} = this;
        if (working) {
            lastParams = params;
            return;
        }
        working = true;
        try {
            const result = await this.workerApi.jscadMain({params});
            lastRunParams = params;
            console.log(lastRunParams);
            this.handlers().entities(result, {})
        } finally {
            working = false;
        }
    }


    async startAnimCallback(def, value) {
        if (this.stopCurrentAnim()) return;
        this.animStatus('running');


        const handleEnd = () => this.stopCurrentAnim();

        this.currentAnim = new AnimRunner(this.workerApi, {handleEntities: this.handleEntities, handleEnd});
        await this.currentAnim.start(def, value, getParams(this.target));
    }

    async pauseAnimCallback(def, value) {
        this.stopCurrentAnim();
    }

    stopCurrentAnim() {
        if (!this.currentAnim) return false;
        this.currentAnim.pause();
        this.currentAnim = null;
        this.animStatus('');
        return true;
    }
}

export default ParameterManager;
