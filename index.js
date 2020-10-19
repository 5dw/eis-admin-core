import Mock from 'mockjs';

export default {
  eisInit: (ctx) => {
    const { Vue, store, config } = ctx;

    const app = {
      FieldComponents: {},
    };
    // all configurations stored in app.config, include config for each module
    // which will overwrite the config in the module itself.
    app.config = config;

    // load modules, merge configurations, get ordered modules according
    // to the dependency relationship, etc.
    app.config.modules = app.config.modules || [];
    app.modules = {};
    app.moduleNames = [];
    app.validators = {};

    Vue.prototype.ctx = app;

    // load modules from local modules folder
    const loadModulesFromFolder = (context, pre = './eis-admin-', ext = '') => {
      const localModules = {};
      const contextKeys = context.keys();
      for (let i = 0; i < contextKeys.length; i += 1) {
        if (!ext || contextKeys[i].indexOf(ext) < 0) {
          let mn = contextKeys[i].substr(pre.length);
          mn = mn.substr(0, mn.indexOf('/'));

          if (contextKeys[i] === `${pre}${mn}/index.js`) { localModules[mn] = context(contextKeys[i]).default; }
        }
      }
      return localModules;
    };

    const localModules = loadModulesFromFolder(require.context('../../src/modules', true, /\/eis-admin-[^/]+\/index\.js$/));
    const globalModules = loadModulesFromFolder(require.context('../../node_modules', true, /\/eis-admin-[^/]+\/index\.js$/));
    const CustomerModules = loadModulesFromFolder(require.context('../../src/modules', true, /\/[^/]+\/index\.js$/), './', 'eis-admin-');

    const loadModule = (m) => {
      let mdl = CustomerModules[m] || localModules[m] || globalModules[m];

      if (!mdl) throw new Error(`Failed to load module: ${m}`);

      if (typeof mdl === 'function') { mdl = mdl(app); }
      app.modules[m] = mdl;

      // check dependencies
      if (mdl.config && mdl.config.dependencies) {
        for (let i = 0; i < mdl.config.dependencies.length; i += 1) {
          loadModule(mdl.config.dependencies[i]);
        }
      }

      // register global filters from module
      if (mdl.filters) {
        Object.keys(mdl.filters).forEach((fk) => {
          Vue.filter(fk, mdl.filters[fk]);
        });
      }

      // register global validators from modules
      if (mdl.validators) {
        Object.keys(mdl.validators).forEach((vk) => {
          if (typeof mdl.validators[vk] === 'function') {
            // const desc = mdl.$t(`${vk}Description`);
            app.validators[vk] = {
              name: vk,
              validator: mdl.validators[vk],
            };
          }
        });
      }

      if (app.moduleNames.indexOf(m) < 0) app.moduleNames.push(m);

      // check backend modules for development env
      app.backendModules = app.backendModules || [];

      if (mdl.config && mdl.config.backendDependencies
        && Array.isArray(mdl.config.backendDependencies)) {
        mdl.config.backendDependencies.forEach((d) => {
          if (app.backendModules.indexOf(d) < 0) app.backendModules.push(d);
        });
      }
    };

    // load modules
    for (let i = 0; i < app.config.modules.length; i += 1) {
      loadModule(app.config.modules[i]);
    }

    const addRefRouters = (rc) => {
      if (!rc) return rc;
      if (typeof rc === 'string' || (typeof rc === 'object' && rc.ref && typeof rc.ref === 'string')) {
        // the child is string, means referrence to another module
        const rcList = (rc.ref || rc).split('>');
        const depModule = app.modules[rcList[0]];
        if (!depModule) {
          throw new Error(`Dependency ${rcList[0]} is not found!`);
        }
        if (!depModule.routers) throw new Error(`Router was not found in ${rcList[0]}`);
        if (!Array.isArray(depModule.routers)) throw new Error(`Routers in ${rcList[0]} are not array!`);

        let realRouters = depModule.routers;
        for (let j = 1; j < rcList.length; j += 1) {
          const rName = rcList[j];
          const childRRouter = realRouters.find(rr => rr.name === rName || rr.path === rName);
          if (!childRRouter) {
            throw new Error(`Child router ${rName} is not found in ${rcList[0]}`);
          }

          if (j === rcList.length - 1) {
            realRouters = childRRouter;
          } else {
            realRouters = childRRouter.children;
          }
        }

        if (Array.isArray(realRouters)) {
          const rRouter = realRouters[0];
          realRouters = rRouter;
        }

        if (rc.ref) {
          return Object.merge(realRouters, rc);
        }
        return realRouters;
      }
      if (rc.children) {
        for (let i = 0; i < rc.children.length; i += 1) {
          rc.children[i] = addRefRouters(rc.children[i]);
        }
      }

      return rc;
    };

    // load routers from modules
    for (let i = 0; i < app.moduleNames.length; i += 1) {
      const mdl = app.modules[app.moduleNames[i]];
      let mRouters = mdl.routers;
      if (typeof mRouters === 'function') {
        mRouters = mRouters(app, mdl, store);
        mdl.routers = mRouters;
      }
      if (mRouters && Array.isArray(mRouters)) {
        for (let j = 0; j < mRouters.length; j += 1) {
          mRouters[j] = addRefRouters(mRouters[j]);
        }
      }
    }

    const modifyModuleView = (routers, view) => {
      for (let i = 0; i < routers.length; i += 1) {
        const router = routers[i];

        if (router.path === view.view) {
          router.component = view.component || router.component;
          router.props = view.props || router.props;
        }

        if (router.children) {
          modifyModuleView(router.children, view);
        }
      }
    };

    // register components in modules to Vue
    for (let i = 0; i < app.moduleNames.length; i += 1) {
      const mdl = app.modules[app.moduleNames[i]];
      Object.merge(mdl.config, app.config[app.moduleNames[i]] || {});
      app.config[app.moduleNames[i]] = mdl.config;

      // register components in modules to Vue
      if (mdl.components) {
        Object.keys(mdl.components).forEach((k) => {
          const comp = mdl.components[k];
          Vue.component(k, comp);
        });
      }

      // register field components in the modules to app
      if (mdl.fieldComponents && typeof mdl.fieldComponents === 'object') {
        app.FieldComponents = Object.assign(app.FieldComponents, mdl.fieldComponents);
      }

      // register mock api
      if (mdl.mock && typeof mdl.mock === 'function') {
        mdl.mock(Mock);
      }

      // modify module views
      if (mdl.config && mdl.config.views && Array.isArray(mdl.config.views)
        && mdl.config.views.length) {
        for (let j = 0; j < mdl.config.views.length; j += 1) {
          const view = mdl.config.views[j];

          if (view && view.module && view.view) {
            const module = app.modules[view.module];
            if (module && module.routers) {
              modifyModuleView(module.routers, view);
            }
          }
        }
      }
    }

    // get route list from module routers and merge config
    let routes = [];
    for (let i = 0; i < app.config.modules.length; i += 1) {
      const mdl = app.modules[app.config.modules[i]];
      if (mdl.routers) { routes = routes.concat(mdl.routers); }
    }

    // eslint-disable-next-line no-underscore-dangle
    app.routes = routes;

    return {
      app,
      routes,
    };
  },
};
