#!/usr/bin/env node
import { program } from 'commander';

import pjson from '../package.json';
import {
  bundleIDToPath,
  checkGitRepoStatus,
  // checkPackageUpdate,
  cleanBuilds,
  copyFiles,
  getAndroidCurrentBundleID,
  getAndroidCurrentName,
  getFlavor,
  getIosCurrentName,
  getIosXcodeProjectPathName,
  gitStageChanges,
  renameAndroidBundleIDFolders,
  renameIosFoldersAndFiles,
  showSuccessMessages,
  updateAndroidFilesContent,
  updateAndroidFilesContentBundleID,
  updateAndroidNameInStringsXml,
  updateAppLinks,
  updateBugfenderKey,
  updateBranchAppDomain,
  updateBranchKey,
  updateCodePushKey,
  updateIosFilesContent,
  updateIosNameInInfoPlist,
  updateOtherFilesContent,
  updateUriScheme,
  validateCreation,
  // validateData,
  validateGitRepo,
  validateNewBundleID,
  validateNewName,
  validateNewPathContentStr,
} from './utils';

program
  .name(pjson.name)
  .description(pjson.description)
  .version(pjson.version)
  .arguments('[newName]')
  .option('--skipGitStatusCheck', 'Skip git repo status check')
  .option('-f, --falvorFilePath [value]', 'Json file that contains the flavors')
  .option('-n --flavorName [value]', 'Name of the flavor')
  .option('--branch', 'Update Branch.io keys and uriScheme')
  .option('--codePush', 'Update codePush keys')
  .option('--bugfender', 'Update bugfender keys')
  .action(async newName => {
    validateCreation();
    validateGitRepo();

    const options = program.opts();

    if (!options.skipGitStatusCheck) {
      checkGitRepoStatus();
    }

    validateNewName(newName, options);

    let newBundleID;
    const flavorsFilePath = options.falvorFilePath;
    const flavorName = options.flavorName;
    const updateBranchSettings = options.branch;
    const updateCodePushSettings = options.codePush;
    const updateBugfender = options.bugfender;
    const flavorData = getFlavor(flavorsFilePath, flavorName);

    // validateData(flavorData);

    if (!newBundleID) {
      newBundleID = flavorData.bundleIdentifier;
    }

    if (flavorsFilePath) {
      validateNewPathContentStr(flavorsFilePath);
    }

    if (newBundleID) {
      validateNewBundleID(newBundleID, ['ios', 'android']);
    }

    const currentAndroidName = getAndroidCurrentName();
    const currentIosName = getIosCurrentName();
    const currentPathContentStr = getIosXcodeProjectPathName();
    const newPathContentStr = newName;
    const currentAndroidBundleID = getAndroidCurrentBundleID();

    await renameIosFoldersAndFiles(newPathContentStr);
    await updateIosFilesContent({
      currentName: currentIosName,
      newName,
      currentPathContentStr,
      newPathContentStr,
      newBundleID: newBundleID,
    });

    await updateIosNameInInfoPlist(newName);

    if (newBundleID) {
      await renameAndroidBundleIDFolders({
        currentBundleIDAsPath: bundleIDToPath(currentAndroidBundleID),
        newBundleIDAsPath: bundleIDToPath(newBundleID),
      });
    }

    await updateAndroidFilesContent({
      currentName: currentAndroidName,
      newName,
      newBundleIDAsPath: bundleIDToPath(newBundleID || currentAndroidBundleID),
    });

    if (newBundleID) {
      await updateAndroidFilesContentBundleID({
        currentBundleID: currentAndroidBundleID,
        newBundleID,
        currentBundleIDAsPath: bundleIDToPath(currentAndroidBundleID),
        newBundleIDAsPath: bundleIDToPath(newBundleID),
      });
    }

    await updateAndroidNameInStringsXml(newName);
    await updateOtherFilesContent({
      newName,
      currentPathContentStr,
      newPathContentStr,
      currentIosName,
      newAndroidBundleID: newBundleID,
      newIosBundleID: newBundleID,
    });

    if (updateBranchSettings) {
      // update branch key and secret
      await updateBranchKey(flavorData.branch.live, flavorData.branch.test);
      // update uriScheme
      await updateUriScheme(newBundleID, flavorData.uriScheme);
      // update App Domain
      await updateBranchAppDomain(flavorData.branch.domain);
      // update App Links
      await updateAppLinks(flavorData.branch);
    }

    if (updateCodePushSettings) {
      // update code push key
      await updateCodePushKey(flavorData.codepush.key);
    }

    if (updateBugfender) {
      // update bugfender key
      await updateBugfenderKey(flavorData.bugfender.key);
    }
    if (flavorData.files) {
      copyFiles(flavorData.files, flavorData.folderName);
    }
    cleanBuilds();
    showSuccessMessages(newName);
    gitStageChanges();
    // checkPackageUpdate();
  });

// If no arguments are passed, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit();
}

program.parseAsync(process.argv);
