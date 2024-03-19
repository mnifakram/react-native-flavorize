import chalk from 'chalk';
import cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { globbySync } from 'globby';
import { decode, encode } from 'html-entities';
import path from 'path';
import replace from 'replace-in-file';
import shell from 'shelljs';
import checkForUpdate from 'update-check';

import pjson from '../package.json';
import {
  androidJava,
  androidManifestXml,
  androidValuesStrings,
  appJson,
  buildPaths,
  getAndroidUpdateBundleIDOptions,
  getAndroidUpdateFilesContentOptions,
  getIosFoldersAndFilesPaths,
  getIosUpdateFilesContentOptions,
  getOtherUpdateFilesContentOptions,
  iosAppDelegate,
  iosXcodeproj,
  packageJson,
} from './paths';

dotenv.config();

const APP_PATH = process.env.DEV_APP_PATH || process.cwd();
const PROMISE_DELAY = 200;
const MAX_NAME_LENGTH = 30;
const NON_LANGUAGE_ALPHANUMERIC_REGEX = /[^\p{L}\p{N}]+/gu;
const MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH = 3;
const VALID_ANDROID_BUNDLE_ID_REGEX = /^[a-zA-Z]{1}[a-zA-Z0-9\._]{1,}$/;
const VALID_IOS_BUNDLE_ID_REGEX = /^[a-zA-Z]{1}[a-zA-Z0-9\.\-]{1,}$/;

const pluralize = (count, noun, suffix = 'es') => `${count} ${noun}${count !== 1 ? suffix : ''}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const toRelativePath = absolutePath => path.relative(APP_PATH, absolutePath);
export const cleanString = str => str.replace(NON_LANGUAGE_ALPHANUMERIC_REGEX, '');
export const bundleIDToPath = bundleID => bundleID.replace(/\./g, '/');
export const decodeXmlEntities = name => decode(name, { level: 'xml' });
export const encodeXmlEntities = name =>
  encode(name, { mode: 'nonAscii', level: 'xml', numeric: 'hexadecimal' });
const normalizePath = process.platform === 'win32' ? require('normalize-path') : p => p;
const androidValuesStringsFullPath = path.join(APP_PATH, androidValuesStrings);

export const validateCreation = () => {
  const iosInfoPlistFullPath = globbySync(
    normalizePath(path.join(APP_PATH, iosAppDelegate))
  )[0].replace('AppDelegate.h', 'Info.plist');
  const fileExists =
    fs.existsSync(iosInfoPlistFullPath) && fs.existsSync(androidValuesStringsFullPath);

  if (!fileExists) {
    console.log('Directory should be created using "react-native init".');
    process.exit();
  }
};

export const validateGitRepo = () => {
  shell.cd(APP_PATH);
  const isGitRepository =
    shell.exec('git rev-parse --is-inside-work-tree', { silent: true }).code === 0;

  if (!isGitRepository) {
    console.log('This is not a git repository');
    process.exit();
  }
};

export const checkGitRepoStatus = () => {
  shell.cd(APP_PATH);
  const output = shell.exec('git status --porcelain', { silent: true }).stdout;
  const isClean = output === '';

  if (!isClean) {
    console.log(
      `The directory is not clean. There are changes that have not been committed to the Git repository.
Clean it first and try again or use "--skipGitStatusCheck" option to skip this check.`
    );
    process.exit();
  }
};

export const validateNewName = (newName, programOptions) => {
  if (!(newName.length <= MAX_NAME_LENGTH)) {
    console.log(`New app name "${newName}" is too long`);
    process.exit();
  }

  const cleanNewName = cleanString(newName);
  const isCleanNewNameLengthValid = cleanNewName.length >= MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH;
  const hasPathContentStr = !!programOptions.pathContentStr;

  // Ask user to provide a custom path and content string if the cleanNewName is less than MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH
  if (!isCleanNewNameLengthValid && !hasPathContentStr) {
    console.log(
      `Please provide path and content string using "-p [value]" or "--pathContentStr [value]" option to be used in renaming the folders, files and their contents.
example: react-native-flavorize "${newName}" -p "[value]"`
    );
    process.exit();
  }
};

export const validateNewPathContentStr = value => {
  const cleanValue = cleanString(value ?? '');
  const isCleanValueLengthValid = cleanValue.length >= MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH;

  if (!isCleanValueLengthValid) {
    console.log(
      'The value provided in --pathContentString or -p option is too short or contains special characters.'
    );
    process.exit();
  }
};

export const validateNewBundleID = (newBundleID, platforms = []) => {
  const isIosBundleIdValid = VALID_IOS_BUNDLE_ID_REGEX.test(newBundleID);
  const isAndroidBundleIdValid = VALID_ANDROID_BUNDLE_ID_REGEX.test(newBundleID);
  const androidErrorMessage = `The bundle identifier "${newBundleID}" for ${chalk.bold(
    'Android'
  )} is not valid. It should contain only alphanumeric characters and dots.`;
  const iosErrorMessage = `The bundle identifier "${newBundleID}" for ${chalk.bold(
    'iOS'
  )} is not valid. It should contain only alphanumeric characters, dots and dashes.`;
  const additionalMessage =
    '\nNote: You can also specify a custom bundle identifier for each platform using "--iosBundleID [value]" and "--androidBundleID [value]" options.';
  const errorMessage = `${androidErrorMessage} \n${iosErrorMessage}`;

  if (
    platforms.includes('ios') &&
    platforms.includes('android') &&
    !isIosBundleIdValid &&
    !isAndroidBundleIdValid
  ) {
    console.log(errorMessage);
    console.log(chalk.yellow(additionalMessage));
    process.exit();
  }

  if (platforms.includes('ios') && !isIosBundleIdValid) {
    console.log(iosErrorMessage);
    console.log(chalk.yellow(additionalMessage));
    process.exit();
  }

  if (platforms.includes('android') && !isAndroidBundleIdValid) {
    console.log(androidErrorMessage);
    console.log(chalk.yellow(additionalMessage));
    process.exit();
  }

  const segments = newBundleID.split('.');

  if (segments.length < 2) {
    console.log(
      `The bundle identifier "${newBundleID}" is not valid. It should contain at least 2 segments, e.g. com.example.app or com.example`
    );
    process.exit();
  }
};

const getElementFromXml = ({ filepath, selector }) => {
  const xml = fs.readFileSync(filepath, 'utf8');
  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: false });

  return $(selector);
};

export const getIosCurrentName = () => {
  const filepath = globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
    'AppDelegate.h',
    'Info.plist'
  );
  const selector = 'dict > key:contains("CFBundleDisplayName") + string';
  const element = getElementFromXml({ filepath, selector });

  return decodeXmlEntities(element.text());
};

export const getAndroidCurrentName = () => {
  const gradleFile = path.join(APP_PATH, 'android', 'settings.gradle');
  const gradleFileContent = fs.readFileSync(gradleFile, 'utf8');

  const projectName = gradleFileContent.match(/rootProject.name\s+=\s+['"](.*)['"]/)[1];

  if (projectName) {
    return projectName;
  }

  throw new Error(`Unable to get project name from settings.gradle for project ${APP_PATH}`);
};

export const getAndroidCurrentBundleID = () => {
  const filepath = path.join(APP_PATH, androidManifestXml);
  const selector = 'manifest';
  const element = getElementFromXml({ filepath, selector });

  // parse AndroidManifest.xml
  const bundleIDFromManifest = element.attr('package');
  if (bundleIDFromManifest) {
    return bundleIDFromManifest;
  }

  // parse android/app/build.gradle
  const gradleFile = path.join(APP_PATH, 'android', 'app', 'build.gradle');
  const gradleFileContent = fs.readFileSync(gradleFile, 'utf8');
  const bundleIDFromGradle = gradleFileContent.match(/applicationId\s+['"](.+)['"]/)[1];

  if (bundleIDFromGradle) {
    return bundleIDFromGradle;
  }

  throw new Error(`Unable to get bundleID from manifest or gradle file for project ${APP_PATH}`);
};

/**
 * Get the name of the xcode project folder
 * e.g. "MyApp.xcodeproj" -> "MyApp"
 * @returns {string} The name of the xcode project folder
 */
export const getIosXcodeProjectPathName = () => {
  const xcodeProjectPath = globbySync(normalizePath(path.join(APP_PATH, iosXcodeproj)), {
    onlyDirectories: true,
  });

  const xcodeProjectPathName = xcodeProjectPath[0].split('/').pop();

  return xcodeProjectPathName.replace('.xcodeproj', '');
};

const renameFoldersAndFiles = async ({
  foldersAndFilesPaths,
  currentPath: currentPathParam,
  newPath: newPathParam,
  createNewPathFirst = false,
  shellMoveCurrentPathGlobEnd = '',
}) => {
  const promises = foldersAndFilesPaths.map(async (filePath, index) => {
    await delay(index * PROMISE_DELAY);
    const currentPath = path.join(APP_PATH, filePath);
    const newPath = path.join(APP_PATH, filePath.replace(currentPathParam, newPathParam));

    if (currentPath === newPath) {
      return console.log(toRelativePath(currentPath), chalk.yellow('NOT RENAMED'));
    }

    if (createNewPathFirst) {
      shell.mkdir('-p', newPath);
    }

    try {
      new Promise(resolve => {
        if (!fs.existsSync(currentPath)) {
          return resolve();
        }

        const shellMove = shell.mv('-f', `${currentPath}${shellMoveCurrentPathGlobEnd}`, newPath);

        if (shellMove.code !== 0) {
          console.log(chalk.red(shellMove.stderr));
        }

        resolve();
        console.log(toRelativePath(newPath), chalk.green('RENAMED'));
      });
    } catch (error) {
      console.log(error);
    }
  });

  await Promise.all(promises);
};

export const renameIosFoldersAndFiles = async newPathContentStr => {
  const currentPathContentStr = getIosXcodeProjectPathName();
  const foldersAndFilesPaths = getIosFoldersAndFilesPaths({
    currentPathContentStr,
    newPathContentStr,
  });

  await renameFoldersAndFiles({
    foldersAndFilesPaths,
    currentPath: cleanString(currentPathContentStr),
    newPath: cleanString(newPathContentStr),
  });
};

export const updateFilesContent = async filesContentOptions => {
  const promises = filesContentOptions.map(async (option, index) => {
    await delay(index * PROMISE_DELAY);

    const isOptionFilesString = typeof option.files === 'string';
    const updatedOption = {
      ...option,
      countMatches: true,
      allowEmptyPaths: true,
      files: isOptionFilesString
        ? path.join(APP_PATH, option.files)
        : option.files.map(file => path.join(APP_PATH, file)),
    };

    try {
      const results = await replace(updatedOption);
      results.map(result => {
        const hasChanged = result.hasChanged;
        const message = `${hasChanged ? 'UPDATED' : 'NOT UPDATED'} (${pluralize(
          result.numMatches || 0,
          'match'
        )})`;
        console.log(
          toRelativePath(result.file),
          hasChanged ? chalk.green(message) : chalk.yellow(message)
        );
      });
    } catch (error) {
      const filePath = error.message.replace('No files match the pattern:', '').trim();
      console.log(toRelativePath(filePath), chalk.yellow('NOT FOUND'));
    }
  });

  await Promise.all(promises);
};

export const updateIosFilesContent = async ({
  currentName,
  newName,
  currentPathContentStr,
  newPathContentStr,
  newBundleID,
}) => {
  const filesContentOptions = getIosUpdateFilesContentOptions({
    currentName,
    newName,
    currentPathContentStr,
    newPathContentStr,
    newBundleID,
  });
  await updateFilesContent(filesContentOptions);
};

const updateElementInXml = async ({ filepath, selector, text }) => {
  const $ = cheerio.load(fs.readFileSync(filepath, 'utf8'), {
    xmlMode: true,
    decodeEntities: false,
  });

  const element = $(selector);
  element.text(encodeXmlEntities(text));
  await fs.promises.writeFile(filepath, $.xml());
  console.log(toRelativePath(filepath), chalk.green('UPDATED'));
};

const updateAttributeInXml = async ({ filepath, selector, attrName, text }) => {
  console.log(filepath);
  const $ = cheerio.load(fs.readFileSync(filepath, 'utf8'), {
    xmlMode: true,
    decodeEntities: false,
  });

  const element = $(selector);
  element.attr(attrName, encodeXmlEntities(text));
  await fs.promises.writeFile(filepath, $.xml());
  console.log(toRelativePath(filepath), chalk.green('UPDATED'));
};

export const updateIosNameInInfoPlist = async newName => {
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'dict > key:contains("CFBundleDisplayName") + string',
    text: newName,
  });
};

export const updateAndroidNameInStringsXml = async newName => {
  await updateElementInXml({
    filepath: androidValuesStringsFullPath,
    selector: 'resources > string[name="app_name"]',
    text: newName,
  });
};

export const renameAndroidBundleIDFolders = async ({
  currentBundleIDAsPath,
  newBundleIDAsPath,
}) => {
  const currentBundleIDFoldersRelativePaths = globbySync(
    normalizePath(path.join(APP_PATH, `${androidJava}`)),
    { onlyDirectories: true }
  ).map(folderPath => normalizePath(toRelativePath(`${folderPath}/${currentBundleIDAsPath}`)));

  await renameFoldersAndFiles({
    foldersAndFilesPaths: currentBundleIDFoldersRelativePaths,
    currentPath: currentBundleIDAsPath,
    newPath: newBundleIDAsPath,
    createNewPathFirst: true,
    shellMoveCurrentPathGlobEnd: '/*',
  });
};

export const updateAndroidFilesContent = async ({ currentName, newName, newBundleIDAsPath }) => {
  const filesContentOptions = getAndroidUpdateFilesContentOptions({
    currentName,
    newName,
    newBundleIDAsPath,
  });

  await updateFilesContent(filesContentOptions);
};

export const updateAndroidFilesContentBundleID = async ({
  currentBundleID,
  newBundleID,
  currentBundleIDAsPath,
  newBundleIDAsPath,
}) => {
  const filesContentOptions = getAndroidUpdateBundleIDOptions({
    currentBundleID,
    newBundleID,
    currentBundleIDAsPath,
    newBundleIDAsPath,
  });

  await updateFilesContent(filesContentOptions);
};

const getJsonContent = jsonFile => {
  return JSON.parse(fs.readFileSync(path.join(APP_PATH, jsonFile), 'utf8'));
};

export const updateOtherFilesContent = async ({
  newName,
  currentPathContentStr,
  newPathContentStr,
  currentIosName,
  newAndroidBundleID,
  newIosBundleID,
}) => {
  const appJsonContent = getJsonContent(appJson);
  const packageJsonContent = getJsonContent(packageJson);

  const filesContentOptions = getOtherUpdateFilesContentOptions({
    currentName: appJsonContent?.name || currentIosName,
    newName,
    currentPathContentStr,
    newPathContentStr,
    packageJsonName: packageJsonContent?.name,
    newAndroidBundleID,
    newIosBundleID,
  });

  await updateFilesContent(filesContentOptions);
};

export const cleanBuilds = () => {
  shell.rm(
    '-rf',
    buildPaths.map(buildPath => path.join(APP_PATH, buildPath))
  );
  console.log(chalk.yellow('Done removing builds.'));
};

export const showSuccessMessages = newName => {
  const appJsonContent = getJsonContent(appJson);
  const isUsingExpo = !!appJsonContent?.expo;

  console.log(
    `
${chalk.green('SUCCESS! 🎉 🎉 🎉')} Your app has been renamed to "${chalk.yellow(newName)}".
`
  );

  if (isUsingExpo) {
    console.log(
      chalk.yellow(`If you need to update EXUpdatesURL in Expo.plist and EXPO_UPDATE_URL in AndroidManifest.xml, please do so manually.
`)
    );
  }

  console.log(
    chalk.yellow(`- Make sure to check old .xcodeproj and .xcworkspace in ios folder, please delete them manually.
- Please make sure to run "npx pod-install" and "watchman watch-del-all" before running the app.

If you like this tool, please give it a star on GitHub: https://github.com/mnifakram/react-native-flavorize

`)
  );
};

export const gitStageChanges = () => {
  shell.cd(APP_PATH);
  shell.exec('git config --local core.autocrlf false');
  shell.exec('git config --local core.safecrlf false');
  shell.exec('git add .');
};

export const checkPackageUpdate = async () => {
  try {
    const res = await checkForUpdate(pjson);

    if (res?.latest) {
      console.log();
      console.log(chalk.green.bold(`A new version of "${pjson.name}" is available.`));
      console.log('Current version:', chalk.yellow(pjson.version));
      console.log('Latest version:', chalk.yellow(res.latest));
      console.log(chalk.cyan(`You can update by running: npm install -g ${pjson.name}.`));
      console.log();
    }
  } catch (error) {
    console.log('Error checking for update:\n%O', error);
  }
};

export const copyFiles = (files, prefix) => {
  files.forEach(file => {
    // Construct the shell command to copy the file with force option
    const sourcePath = `${prefix}/${file.src}`;
    // if (fs.lstatSync(sourcePath).isDirectory()) {

    // }

    const command = `cp -fR ${sourcePath} ${file.dest}`;

    // Execute the command
    const { code, _, stderr } = shell.exec(command);

    // Check for errors
    if (code !== 0) {
      console.error(`Error copying ${sourcePath} to ${file.dest}: ${stderr}`);
    } else {
      console.log(chalk.green(`Successfully copied ${sourcePath} to ${file.dest}.`));
    }
  });
};

export const getFlavor = (filepath, key) => {
  const jsonData = fs.readFileSync(filepath, 'utf8');
  // Read the JSON file

  try {
    // Parse JSON data
    const jsonObject = JSON.parse(jsonData);

    // Check if the key exists in the object
    if (key in jsonObject) {
      return jsonObject[key];
    } else {
      throw new Error(`Key '${key}' not found in the JSON file.`);
    }
  } catch (error) {
    console.error('Error reading JSON file:', error.message);

    return null;
  }
};

export const updateCodePushKey = async key => {
  await updateElementInXml({
    filepath: androidValuesStringsFullPath,
    selector: 'resources > string[name="CodePushDeploymentKey"]',
    text: key,
  });
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'dict > key:contains("CodePushDeploymentKey") + string',
    text: key,
  });
};

export const updateBugfenderKey = async newValue => {
  const options = {
    files: 'app.json',
    from: /("BugfenderKey"\s*:\s*")([^"]*)(")/,
    to: `$1${newValue}$3`,
  };

  try {
    await replace(options);
    console.log('BugfenderKey updated');
  } catch (error) {
    console.error('Error occurred while changing BugfenderKey', error);
  }
};

export const updateBranchKey = async (liveKey, testKey) => {
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'meta-data[android\\:name="io.branch.sdk.BranchKey"]',
    attrName: 'android:value',
    text: liveKey,
  });
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'meta-data[android\\:name="io.branch.sdk.BranchKey.test"]',
    attrName: 'android:value',
    text: testKey,
  });
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'dict > key:contains("branch_key") + dict > key:contains("live") + string',
    text: liveKey,
  });
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'dict > key:contains("branch_key") + dict > key:contains("test") + string',
    text: testKey,
  });
};

export const updateBranchAppDomain = async domain => {
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'dict > key:contains("branch_app_domain") + string',
    text: domain,
  });
};

export const updateUriScheme = async (bundleIdentifier, uriScheme) => {
  const selector = 'intent-filter[android\\:label="uriScheme"] > data:first-child';
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector,
    attrName: 'android:scheme',
    text: uriScheme,
  });

  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'key:contains(CFBundleURLName) + string',
    text: bundleIdentifier,
  });
  await updateElementInXml({
    filepath: globbySync(normalizePath(path.join(APP_PATH, iosAppDelegate)))[0].replace(
      'AppDelegate.h',
      'Info.plist'
    ),
    selector: 'key:contains(CFBundleURLSchemes) + array string:first-of-type',
    text: uriScheme,
  });
};

export const updateAppLinks = async branchSettings => {
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'intent-filter[android\\:label="appLinks"] > data:nth-child(4)',
    attrName: 'android:host',
    text: branchSettings.domain,
  });
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'intent-filter[android\\:label="appLinks"] > data:nth-child(5)',
    attrName: 'android:host',
    text: branchSettings.alternateDomain,
  });
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'intent-filter[android\\:label="appLinks"] > data:nth-child(6)',
    attrName: 'android:host',
    text: branchSettings.testDomain,
  });
  await updateAttributeInXml({
    filepath: path.join(APP_PATH, androidManifestXml),
    selector: 'intent-filter[android\\:label="appLinks"] > data:nth-child(7)',
    attrName: 'android:host',
    text: branchSettings.testAlternateDomain,
  });
};

export const validateData = (environment, data) => {
  const envKeys = data[environment];

  if (!envKeys) {
    console.log(chalk.red(`No keys found for environment ${chalk.bold(environment)}`));
    process.exit();
  }
  const isValidCodePushKey =
    environment === 'staging' || (envKeys.codepush && envKeys.codepush.key.length > 6);

  if (!isValidCodePushKey) {
    console.log(chalk.red(`No codepush keys found for environment ${chalk.bold(environment)}`));
    process.exit();
  }

  const isValidBranchSettings = envKeys.branch && envKeys.branch.key.length > 6;

  if (!isValidBranchSettings) {
    console.log(chalk.red(`No branch keys found for environment ${chalk.bold(environment)}`));
    process.exit();
  }
};
