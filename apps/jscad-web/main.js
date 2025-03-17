import Launcher from './src/launcher.js';
import defaultCode from './examples/jscad.example.js';
import {setError} from "./src/error.js";

const appBase = document.baseURI;
const toUrl = (path) => new URL(path, appBase).toString();

const bundles = {
    '@jscad/modeling': toUrl('./build/bundle.jscad_modeling.js'),
    '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
    '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
};

const launcher = new Launcher();
launcher.workerApi.jscadInit({bundles});
launcher.initMenu();
launcher.initWelcome();
Promise.all([
    launcher.initEngine(),
    launcher.initEditor(defaultCode),
    launcher.initRemoteScript(),
    launcher.initExporter(),
]).then(async () => {
    launcher.setFileTree().then(()=>{
        console.log("fake FS success");
    })
    window.launcher = launcher;
 }).catch((err) => {
    setError(err);
});

(async () => {
    if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
        const lastReload = localStorage.getItem('lastReload');
        if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
            setError('Failed to start the service worker, reloading');
            localStorage.setItem('lastReload', Date.now().toString());
            // location.reload();
        } else {
            console.error('Failed to start the service worker, requires reloading');
        }
        setError('Failed to start the service worker, requires reloading');
    }
    launcher.updateFromCtrl(launcher.ctrl);

})();
