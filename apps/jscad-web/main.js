import Launcher from './src/launcher.js';
import defaultCode from './examples/jscad.example.js'
import {setError} from "./src/error.js";

const appBase = document.baseURI;
const toUrl = path => new URL(path, appBase).toString();

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
  launcher.initExporter()
]).then(() => {
  if (launcher.loadDefault && !launcher.hasRemoteScript) {
    launcher.jscadScript({script: defaultCode}).then(r => {
    });
  }
}).catch(err => {
  setError(err);
});

(async () => {
  if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
    const lastReload = localStorage.getItem('lastReload');
    if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
      setError('无法启动服务工作者，正在重新加载');
      localStorage.setItem('lastReload', Date.now().toString());
      //location.reload();
    } else {
      console.error('无法启动服务工作者，需要重新加载');
    }
    setError('无法启动服务工作者，需要重新加载');
  }
  launcher.updateFromCtrl(launcher.ctrl);
})();
