// ==UserScript==
// @name         Queslar Betterment Script
// @namespace    https://www.queslar.com
// @version      1.5
// @description  A script that lets you know info about quests and more!
// @author       RiddleMeDoo
// @include      *queslar.com*
// @grant        none
// @require      https://raw.githubusercontent.com/RiddleMeDoo/qs-bettermentScript/master/quests_1_0.js
// ==/UserScript==

async function getCatacombData() {
  /***
   * Returns Observatory boost, action timer in seconds
  ***/
  // Wait until services load
  while(gameData?.playerCatacombService === undefined || gameData?.playerVillageService === undefined) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const tomes = gameData.playerCatacombService.calculateTomeOverview();
  const villageService = gameData.playerVillageService;

  let villageActionSpeedBoost;
  if (villageService?.isInVillage === true) {
    const level = villageService?.buildings?.observatory?.amount ?? 0;
    villageActionSpeedBoost = (Math.floor(level / 20) * Math.floor(level / 20 + 1) / 2 * 20 + (level % 20) * Math.floor(level / 20 + 1)) / 100;
  } else {
    villageActionSpeedBoost = 0;
  }

  return {
    villageActionSpeed: villageActionSpeedBoost,
    actionTimerSeconds: 24 / (1 + villageActionSpeedBoost + tomes.speed / 100) 
  }
} 

function handleCatacombPage(mutation, catacombInfo) {
  if(
    mutation?.addedNodes?.[0]?.localName === 'mat-tooltip-component' ||
    mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
    mutation?.addedNodes?.[0]?.nodeName === '#text'
  ) {
    return;
  }
  // Inactive view
  const parentElement = document.querySelector('app-catacomb-main').firstChild.children[1].firstChild.firstChild;
  const totalMobs = parseInt(parentElement.firstChild.children[1].firstChild.children[11].children[1].innerText);
  const toInsertIntoEle = parentElement.children[1];
  
  // Create the end time ele to insert into
  const endTimeEle = document.createElement('div');
  endTimeEle.id = 'catacombEndTime';
  return;
}

class Script {
  constructor() {
    // Get quest data
    this.quest = {
      questsCompleted: 0,
      numRefreshes: 0,
      refreshesUsed: 0,
      villageBold: 0,
      villageSize: 1,
      villageNumRefreshes: 5,
      villageRefreshesUsed: 0,
      baseStat: 15,
      minActions: 360,
      maxActions: 580,
    };
    this.settings = JSON.parse(localStorage.getItem('QuesBS_settings')) ?? {
      strActions: 30000
    }
    this.catacomb = {
      villageActionSpeed: 0,
      actionTimerSeconds: 24,
    }

    //observer setup
    this.initObservers();
    this.currentPath = window.location.hash.split('/').splice(2).join();
  }

  async initQuestData(gameData) {
    //Couldn't find an easier method to get quest completions than a POST request
    gameData.httpClient.post('/player/load/misc', {}).subscribe(
      val => {
        this.quest.questsCompleted = val.playerMiscData.quests_completed;
        this.quest.playerId = val.playerMiscData.player_id;
      },
      response => console.log('QuesBS: POST request failure', response)
    );

    const questData = await updateQuestData(gameData);
    this.quest = {...this.quest, ...questData};
  }

  async initCatacombData() {
    this.catacomb = await getCatacombData();
  }

  initObservers() {
    /**
     * Initialize observers which will be used to detect changes on
     * each specific page when it updates.
     */
    let scriptObject = this; //mutation can't keep track of this
    this.personalQuestObserver = new MutationObserver(mutationsList => {
      handlePersonalQuest(mutationsList[0], scriptObject.quest);
    });
    this.villageQuestObserver = new MutationObserver(mutationsList => {
      handleVillageQuest(mutationsList[0], scriptObject.quest, scriptObject.settings.strActions);
    });
    this.catacombObserver = new MutationObserver(mutationsList => {
      handleCatacombPage(mutationsList[0], scriptObject.catacomb);
    });
  }

  async initPathDetection() {
    /**
    * Initializes the event trigger that will watch for changes in the
    * url path. This will allow us to determine which part of the
    * script to activate on each specific page.
    */
    let router = gameData?.router
    //Wait for service to load
    while(router === undefined && router?.events === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
      router = gameData?.router
    }
    gameData.router.events.subscribe(event => {
      if(event.navigationTrigger) this.handlePathChange(event.url);
    });

    //Send a popup to player as feedback
    gameData.snackbarService.openSnackbar('QuesBS has been loaded.');
  }


  async handlePathChange(url) {
    /**
     * Detects which page the player navigated to when the url path
     * has changed, then activates the observer for the page. 
     */
    const path = url.split('/').slice(2);
    if(path.join() !== this.currentPath) {
      this.stopObserver(this.currentPath);
    }
    this.currentPath = path.join();
    //Activate observer if on a specific page
    if(path[path.length - 1].toLowerCase() === 'quests' && path[0].toLowerCase() === 'actions') {
      //Observe personal quest page for updates
      let target = document.querySelector('app-actions');
      //Sometimes the script attempts to search for element before it loads in
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-actions');
      }
      this.personalQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
      //Sometimes there is no change observed for the initial page load, so call function
      await handlePersonalQuest({target: target});

    } else if(path[path.length - 1].toLowerCase() === 'quests' && path[0].toLowerCase() === 'village') {
      //Observe village quest page for updates
      let target = document.querySelector('app-village');
      //Sometimes the script attempts to search for element before it loads in
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-village');
      }
      this.villageQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
      //Sometimes there is no change observed for the initial page load, so call function
      await handleVillageQuest({target: target}, this.quest, this.settings.strActions);

    } else if(path[path.length - 1].toLowerCase() === 'settings' && path[0].toLowerCase() === 'village') {
      //const target = document.querySelector('app-village-settings').firstChild;
      //Insert our own settings box
      await this.insertVillageSettingsElem();
    } else if(path[path.length - 1].toLowerCase() === 'catacomb' && path[0].toLowerCase() === 'catacombs') {
      let target = document.querySelector('app-catacomb-main');
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-catacomb-main').firstChild;
        if (target.nodeName === '#comment') {
          // Then it's an active catacomb, only listen for change in active/inactive state
          this.catacombObserver.observe(target.parentElement, {
            childList: true, subtree: false, attributes: false,
          });
          
        } else {
          this.catacombObserver.observe(target, {
            childList: true, subtree: true, attributes: false,
          });
        }
      }
      
    }
  }

  stopObserver(pathname) {
    const stop = {
      'actions,quests': () => this.personalQuestObserver.disconnect(),
      'village,quests': () => this.villageQuestObserver.disconnect(),
      'catacombs,catacomb': () => this.catacombObserver.disconnect(),
    }
    if(stop[pathname]) stop[pathname]();
  }
  
  async insertVillageSettingsElem() {
    /**
     * Inserts a custom settings box into the village settings page
     */
    //Get settings page contents
    let settingsOverview = document.querySelector('app-village-settings');
    while(!settingsOverview) {
      await new Promise(resolve => setTimeout(resolve, 50));
      settingsOverview = document.querySelector('app-village-settings');
    }

    //Clone a copy of the armory settings to match the css style
    const questSettings = settingsOverview.firstChild.children[1].cloneNode(true);
    //Modify to our liking
    questSettings.firstChild.children[3].remove();
    questSettings.firstChild.children[2].remove();
    questSettings.firstChild.firstChild.innerText = 'QuesBS Highlight Quest';
    questSettings.firstChild.children[1].firstChild.innerText = 'Max actions for strength point';
    questSettings.firstChild.children[1].children[1].id = 'actionsLimitSetting';
    questSettings.firstChild.children[1].children[1].style.width = '50%';
    questSettings.firstChild.children[1].children[1].firstChild.value = this.settings.strActions;
    questSettings.firstChild.children[1].children[1].firstChild.style.width = '6em';
    questSettings.firstChild.children[2].firstChild.firstChild.innerText = 'Save QuesBS Quests';
    //Add a save function for button
    questSettings.firstChild.children[2].firstChild.onclick = () => {
      const newActions = parseInt(document.getElementById('actionsLimitSetting').firstChild.value);
      //Data validation
      if(isNaN(newActions)) {
        gameData.snackbarService.openSnackbar('Error: Value should be a number'); //feedback popup
      } else {
        this.settings.strActions = newActions;
        localStorage.setItem('QuesBS_settings', JSON.stringify(this.settings));
        gameData.snackbarService.openSnackbar('Settings saved successfully'); //feedback popup
      }
    }
    settingsOverview.appendChild(questSettings);
  }
}

async function getGameData(numAttempts) { //ULTIMATE POWER
  //Get a reference to *all* the data the game is using to run
  let gameData = getAllAngularRootElements()[0].children[2]['__ngContext__'][30]?.playerGeneralService;
  while(gameData === undefined && numAttempts > 0) { //Power comes with a price; wait for it to load
    await new Promise(resolve => setTimeout(resolve, 500))
    gameData = getAllAngularRootElements()[0].children[2]['__ngContext__'][30]?.playerGeneralService;
    numAttempts--;
  }
  if (!gameData) console.log('QuesBS: Game Data could not be loaded. The script will not work without it. Please refresh the page and try again.');

  return gameData;
}


// This is where the script starts
var QuesBS = null;
console.log('QuesBS: Init load');
let QuesBSLoader = null;
let numAttempts = 30;
const gameData = await getGameData(600);
QuesBSLoader = setInterval(setupScript, 3000);

window.startQuesBS = () => { // If script doesn't start, call this function (ie. startQuesBS() in the console)
  QuesBSLoader = setInterval(setupScript, 3000);
}

async function setupScript() {
  if(document.getElementById('profile-next-level') && QuesBS === null) {
    QuesBS = new Script();
    console.log('QuesBS: The script has been loaded.');

    clearInterval(QuesBSLoader);
    await QuesBS.initPathDetection();
    await QuesBS.initQuestData(gameData);
    await QuesBS.initCatacombData();
  } else if(QuesBS) {
    console.log('QuesBS: The script has already been loaded.');
    clearInterval(QuesBSLoader);
  } else {
    console.log('QuesBS: Loading failed. Trying again...');
    numAttempts--;
    if(numAttempts <= 0) {
      clearInterval(QuesBSLoader); //Stop trying after a while
      console.log('QuesBS: Loading failed. Stopping...');
    }
  }
}