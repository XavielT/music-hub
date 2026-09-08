// Angular generates a default karma config when there is none. This one exists
// for a single reason: CI needs a headless Chrome launched with --no-sandbox,
// and there is nowhere else to define a custom launcher.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadless'],
    restartOnFileChange: true,
    customLaunchers: {
      // Some CI containers run as root, where Chrome's own sandbox refuses to
      // start. Only used by the workflows — locally the sandbox works and is
      // worth keeping.
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
  });
};
