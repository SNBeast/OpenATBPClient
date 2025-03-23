var app = require("app"); // Module to control application life.
var fs = require("fs-extra");
var os = require("os");
var dialog = require("dialog");
var BrowserWindow = require("browser-window");
var ChildProcess = require("child_process");
var shell = require("shell");

var mainWindow = null;
var config = null;
var initialPageLoad = false;

var pathSeparator = process.platform == "win32" ? "\\" : "/";
var configPath = app.getPath("userData") + pathSeparator + "config.json";

app.commandLine.appendSwitch("--enable-npapi");

if (process.platform == "darwin") {
    var full_osx_version = ChildProcess.execSync("sw_vers -productVersion")
        .toString()
        .trim()
        .split(".");
    var osx_release =
        full_osx_version[0] == "10"
            ? Number(full_osx_version[1])
            : (Number(full_osx_version[0]) + 5); // + 5 to cause Big Sur and up to follow Catalina as they should instead of overlapping El Capitan
    if (osx_release < 12) {
        app.commandLine.appendSwitch("--ignore-certificate-errors");
    }
}

function readU32BE(buffer, index) {
    return (
        ((buffer[index] << 24) |
            (buffer[index + 1] << 16) |
            (buffer[index + 2] << 8) |
            buffer[index + 3]) >>>
        0
    ); // rotation by zero converts to unsigned
}

function ensureUnity(callback) {
    if (process.platform == "win32") {
        var utilsdir = process.env.npm_node_execpath
            ? app.getAppPath() + "\\build\\utils"
            : __dirname + "\\..\\..\\utils";

        // verify
        var dllpath =
            app.getPath("appData") +
            "\\..\\LocalLow\\Unity\\WebPlayer\\player\\3.x.x\\webplayer_win.dll";

        if (fs.existsSync(dllpath)) {
            var buff = fs.readFileSync(dllpath);
            var hash = require("crypto")
                .createHash("md5")
                .update(buff)
                .digest("hex");
            if (hash == "33ffd00503b206260b0c273baf7e122e") {
                return callback(); // it's here, no need to install
            }
        }

        // run the installer silently
        var child = ChildProcess.spawn(utilsdir + "\\UnityWebPlayer.exe", [
            "/quiet",
            "/S",
        ]);
        child.on("exit", function () {
            console.log("Unity Web Player installed successfully.");
            return callback();
        });
    } else if (process.platform == "darwin") {
        // make sure that the base plugin is 64-bit
        var pluginpath = "/Library/Internet Plug-Ins/Unity Web Player.plugin";
        var playerpath =
            pluginpath +
            "/Contents/Frameworks/StableUnityPlayer3.x.x-x86_64.bundle";
        var installed = false;
        if (fs.existsSync(pluginpath + "/Contents/MacOS/Unity Web Player")) {
            var buff = fs.readFileSync(
                pluginpath + "/Contents/MacOS/Unity Web Player"
            );
            // is a 64-bit single-arch Mach-O...
            if (readU32BE(buff, 0) == 0xfeedfacf) {
                // for x86_64
                installed = readU32BE(buff, 4) == 0x01000007;
            }
            // or is a multi-arch Mach-O...
            else if (readU32BE(buff, 0) == 0xcafebabe) {
                var archs = readU32BE(buff, 4);

                // where one of the arches...
                for (var i = 0; i < archs; i++) {
                    // is x86_64
                    if (readU32BE(buff, 20 * i + 8) == 0x01000007) {
                        installed = true;
                        break;
                    }
                }
            }
        }
        if (!installed) {
            // the base plugin can't be automatically installed on Darwin, so the user will have to do it for us
            dialog.showErrorBox(
                "Error!",
                'Unity Web Player is not installed.\n\nPlease install the bundled Unity Web Player ("webplayer-mini.dmg"), then restart this app.'
            );
            app.quit();
        }

        if (fs.existsSync(playerpath)) {
            // no real need to check further
            return callback();
        } else {
            if (process.env.npm_node_execpath) {
                dialog.show(
                    "Info",
                    'NPM run doesn\'t support auto-installing bundles. If load fails, unquarantine "build/UnityPlayer3.x.x-x86_64.bundle.zip" and extract as "' +
                        playerpath +
                        '".'
                );
            } else {
                fs.copySync(
                    __dirname + "/../StableUnityPlayer3.x.x-x86_64.bundle",
                    playerpath
                );
            }
        }

        return callback();
    } else {
        // Unity Web Player doesn't support other platforms, so good luck!
        return callback();
    }
}

function initialSetup(firstTime) {
    // Display a small window to inform the user that the app is working
    setupWindow = new BrowserWindow({
        width: 275,
        height: 450,
        resizable: false,
        center: true,
        frame: false,
    });
    setupWindow.loadUrl("file://" + __dirname + "/initialsetup.html");
    ensureUnity(function () {
        if (firstTime) {
            // Copy default config
            fs.copySync(
                __dirname +
                    pathSeparator +
                    "defaults" +
                    pathSeparator +
                    "config.json",
                configPath
            );
        }
        setupWindow.destroy();
        showMainWindow();
    });
}

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    if (process.platform != "darwin") app.quit();
});

app.on("ready", function () {
    if (process.platform != "darwin") {
        // Check just in case the user forgot to extract the zip.
        zip_check = app.getPath("exe").includes(os.tmpdir());
        if (zip_check) {
            errormsg =
                "It has been detected that OpenATBPClient is running from the TEMP folder.\n\n" +
                "Please extract the entire Client folder to a location of your choice before starting OpenATBPClient.";
            dialog.showErrorBox("Error!", errormsg);
            return;
        }
    }

    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1090,
        height: 776,
        show: false,
        "web-preferences": { plugins: true },
    });
    mainWindow.setMinimumSize(640, 480);

    // Check for first run
    try {
        if (!fs.existsSync(configPath)) {
            console.log("Config file not found. Running initial setup.");
            initialSetup(true);
        } else {
            ensureUnity(showMainWindow);
        }
    } catch (ex) {
        dialog.showErrorBox(
            "Error!",
            "An error occurred while checking for the config. Make sure you have sufficent permissions."
        );
        app.quit();
    }

    mainWindow.on("closed", function () {
        mainWindow = null;
    });
});

function showMainWindow() {
    config = fs.readJsonSync(configPath);

    console.log("Game URL:", config["game-url"]);
    mainWindow.loadUrl(config["game-url"]);

    // Reduces white flash when opening the program
    mainWindow.webContents.on("did-finish-load", function () {
        mainWindow.show();
        mainWindow.webContents.executeJavaScript("OnResize();");
        //mainWindow.webContents.openDevTools()
    });

    mainWindow.webContents.on("plugin-crashed", function () {
        dialog.showErrorBox(
            "Error!",
            "Unity Web Player has crashed. Please re-open the application."
        );
        mainWindow.destroy();
        app.quit();
    });

    mainWindow.webContents.on("will-navigate", function (evt, url) {
        evt.preventDefault();

        if (!url.startsWith(config["game-url"])) {
            shell.openExternal(url);
        } else {
            mainWindow.loadUrl(url);
            initialPageLoad = true;
        }
    });

    mainWindow.webContents.on("did-fail-load", function () {
        if (!initialPageLoad) {
            dialog.showErrorBox(
                "Error!",
                "Could not load page. Check your Internet connection, and game-url inside config.json."
            );
            mainWindow.destroy();
            app.quit();
        }
    });
}
