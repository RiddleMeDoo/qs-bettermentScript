// ==UserScript==
// @name         Queslar Betterment Script
// @namespace    https://www.queslar.com
// @version      1.5.0
// @description  A script that lets you know info about quests and more! This version has all of the code in one file.
// @author       RiddleMeDoo
// @include      *queslar.com*
// @grant        none
// ==/UserScript==

async function updateQuestData(gameData) {
  /**
   * A function to be called when the game loads in
  **/
  const quest = await getPlayerRefreshes(gameData);
    
  let villageService = gameData.playerVillageService;
  //Wait for service to load
  while(villageService === undefined) {
    await new Promise(resolve => setTimeout(resolve, 200));
    villageService = gameData.playerVillageService;
  }
  
  if(villageService?.isInVillage === true) {
    quest.villageSize = villageService.general.members.length;
    quest.villageBold = villageService.strengths.bold.amount;
    quest.villageNumRefreshes = villageService.general.dailyQuestsBought + 5;
    quest.villageRefreshesUsed = villageService.general.dailyQuestsUsed;
  }
  //Can't be bothered to calculate it accurately using all 4 stats
  quest.baseStat = Math.min(15, gameData.playerStatsService?.strength * 0.0025);
  
  return quest;
}

async function getPartyActions(gameData, playerId) {
  //A function to wait for party service to load
  //And also to abstract the horribly long method
  while(gameData?.partyService?.partyOverview?.partyInformation === undefined) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return gameData.partyService.partyOverview.partyInformation[playerId].actions.daily_actions_remaining;
}

async function getPlayerRefreshes(gameData) {
  //Only made a load waiter because script was having issues with not loading
  while(gameData?.playerQuestService?.refreshesUsed === undefined) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return {
    numRefreshes: gameData.playerQuestService.refreshesBought + 20,
    refreshesUsed: gameData.playerQuestService.refreshesUsed
  };
}

async function getVillageRefreshes() {
  while(gameData?.playerVillageService?.general?.dailyQuestsUsed === undefined) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  let villageService = gameData.playerVillageService;
  return {
    villageNumRefreshes: villageService.general.dailyQuestsBought + 5,
    villageRefreshesUsed: villageService.general.dailyQuestsUsed
  };
}

function getStatReward(quest) {
  /**
   * Returns the possible max and min values for stat quests
   */
  return {
    max: Math.round((quest.questsCompleted/300+quest.baseStat+22.75)*(1+quest.villageBold*2/100)*1.09),
    min: Math.round((quest.questsCompleted/300+quest.baseStat+8.5)*(1+quest.villageBold*2/100)*1.09),
  }
}


/*** Observer triggers ***/ 
async function handlePersonalQuest(mutation, questInfo) {
  /**
   * Handles a new update to the personal quests page. It loads in all
   * the extra quest information, which differs depending on an active or
   * non-active quest page view.
   */
  //Filter out any unneeded mutations/updates to the page
  if(mutation?.addedNodes?.length < 1 ||
    mutation?.addedNodes?.[0]?.localName === 'mat-tooltip-component' ||
    mutation?.addedNodes?.[0]?.nodeName === 'TH' ||
    mutation?.addedNodes?.[0]?.nodeName === 'TD' ||
    mutation?.addedNodes?.[0]?.nodeName === '#text' ||
    mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
    mutation?.addedNodes?.[0]?.id === 'questInfoRow') {
    return;
  }
  //Modify the table used to hold quest information
  const questTable = mutation.target.parentElement.tagName === 'TABLE' ? mutation.target.parentElement : mutation.target.querySelector('table');

  if(questTable) {
    let infoRow = null;

    //Add end time column to table
    addEndTimeColumn(questTable);

    const tableBody = questTable.children[1];

    //There are two states: active quest and no quest
    if(tableBody.children.length > 2) {//No quest
      //Get the info row that goes at the bottom
      infoRow = await insertEndTimeElem(tableBody, questInfo, false, false);

    } else if(tableBody.children.length > 0) { //Active quest
      //Update number of refreshes used, just in case
      const refreshes = await getPlayerRefreshes(gameData);
      infoRow = await insertEndTimeElem(tableBody, {...questInfo, ...refreshes}, false, true);

    } else {
      return;
    }

    //Add an extra row for extra quest info if there isn't one already
    if(!document.getElementById('questInfoRow')) tableBody.appendChild(infoRow);
  }
}

async function handleVillageQuest(mutation, questInfo, strActionsSetting) {
  /**
   * Handles a new update to the village quests page. It loads in all
   * the extra quest information, which differs depending on an active or
   * non-active quest page view.
   */
  //Filter out unneeded mutations/updates to page
  if(mutation?.addedNodes?.length < 1 ||
    mutation?.addedNodes?.[0]?.nodeName === '#text' ||
    mutation?.addedNodes?.[0]?.nodeName === 'TH' ||
    mutation?.addedNodes?.[0]?.nodeName === 'TD' ||
    mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
    mutation?.addedNodes?.[0]?.id === 'questInfoRow') {
    return;
  }
  const questTable = mutation.target.parentElement.tagName === 'TABLE' ? mutation.target.parentElement : mutation.target.querySelector('table');

  if(questTable) {
    const villageRefreshes = await getVillageRefreshes(); //Update for refreshes used
    questInfo.villageRefreshesUsed = villageRefreshes.villageRefreshesUsed;
    addEndTimeColumn(questTable);

    //Add end time
    const tableBody = questTable.children[1];

    //Add end time elems to the end time column
    if(tableBody.children.length > 2) { //Quest is not active
      await insertEndTimeElem(tableBody, {...questInfo}, true, false, strActionsSetting);
    } else { //Quest is active
      await insertEndTimeElem(tableBody, {...questInfo}, true, true, strActionsSetting);
    }

    //Add info text at the bottom of quest table
    const infoRow = document.createTextNode('End time is calculated assuming all members are active. The time is approximate and may not be accurate.'
      + `${questInfo.villageRefreshesUsed}/${questInfo.villageNumRefreshes} refreshes used.`);
    infoRow.id = 'questExplanation';
    if(questTable.parentElement.lastChild.id !== 'questExplanation') {
      questTable.parentElement.appendChild(infoRow);
    }
  }
}


/*** ELEMENT CREATION ***/
async function getQuestInfoElem(actionsNeeded, questInfo) {
  /**
   * Returns the info row used for active personal quest page
   */
  const partyActions = await getPartyActions(gameData, questInfo.playerId);
  let row = document.createElement('tr');

  const date = new Date();
  //actionsNeeded * 6000 = actions * 6 sec per action * 1000 milliseconds
  const finishPartyTime = new Date(date.getTime() + (actionsNeeded + partyActions) * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
  const info = ['',`${questInfo.refreshesUsed}/${questInfo.numRefreshes} refreshes used`, '',
    actionsNeeded >= 0 ? `End time (local time) with ${partyActions} party actions: ${finishPartyTime}`: ''];
  let htmlInfo = '';
  for (let text of info) {
    htmlInfo += `<td>${text}</td>`
  }
  row.innerHTML = htmlInfo;
  row.id = 'questInfoRow';
  return row;
}

function getTimeElem(actionsNeeded, className, numPeople=1) {
  /**
   * Returns an element used to describe the end time for each quest, used for
   * the end time column. It has styled CSS through the className, and the
   * time calculation differs for village vs personal. If there are an 
   * invalid number of actionsNeeded, the time is N/A.
   */
  const cell = document.createElement('td');

  if(actionsNeeded > 0) {
    const date = new Date();
    //actionsNeeded * 6 sec per action * 1000 milliseconds / numPeople
    const finishTime = new Date(date.getTime() + actionsNeeded * 6000 / numPeople).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
    cell.innerText = finishTime;
  } else {
    cell.innerText = 'N/A';
  }
  cell.setAttribute('class', className);
  return cell;
}

function getQuestRatioInfo(quest) {
  //Return info row used for inactive personal quests
  let row = document.createElement('tr');
  const stat = getStatReward(quest);
  const avg = (stat.max/quest.minActions + stat.min/quest.maxActions) / 2;
  const info = ['Possible stat ratios, considering quests completed & village bold:',
  `Worst ratio: ${(stat.min/quest.maxActions).toFixed(3)}`,
  `Avg ratio: ${(avg).toFixed(3)}`,
  `Best Ratio: ${(stat.max/quest.minActions).toFixed(3)}`,
    ''
  ];
  let htmlInfo = '';
  for (let text of info) {
    htmlInfo += `<td>${text}</td>`
  }
  row.innerHTML = htmlInfo;
  row.setAttribute('class', 'mat-row cdk-row ng-star-inserted');
  row.id = 'questInfoRow';
  return row;
}

function addEndTimeColumn(tableElem) {
  //Given a table element, add a new column for end time and add times to each row
  if(tableElem === undefined) return;

  //Add header title for the column
  if(tableElem?.firstChild?.firstChild?.nodeType !== 8 &&
    (tableElem.firstChild.firstChild.children?.[3]?.id !== 'endTimeHeader' //Inactive vs active quest
    && tableElem.firstChild.firstChild.children?.[4]?.id !== 'endTimeHeader')) {
    const header = document.createElement('th');
    header.innerText = 'End Time (local time)';
    header.id = 'endTimeHeader';
    header.setAttribute('class', tableElem.firstChild.firstChild?.firstChild?.className ?? 'mat-header-cell cdk-header-cell cdk-column-current mat-column-current ng-star-inserted');
    tableElem.firstChild.firstChild.appendChild(header);
  }
}

async function insertEndTimeElem(tableBody, questInfo, isVillage, isActiveQuest, strActions=0) {
  /* Returns info row because I suck at structure 
  ** Also inserts the end time for each quest 
  */
  //First, determine if quest is active
  if(isActiveQuest && tableBody.children[0]) {
    //If it is, parse the text directly to get the end time
    const row = tableBody.children[0];
    const objectiveElemText = row?.children[1].innerText.split(' ');
    let timeElem;
    if(objectiveElemText[3].toLowerCase() === 'actions' || objectiveElemText[3].toLowerCase() === 'survived') {
      const actionsDone = parseInt(objectiveElemText[0]);
      const objective = parseInt(objectiveElemText[2]);
      const reward = row.children[2].innerText.split(' ');
      let actionsNeeded = -1;

      //Special case: Party action quest (because it has 7 sec timer)
      if(row.children[2].innerText.split(' ')[1].toLowerCase() === 'party') {
        actionsNeeded = (objective - actionsDone) * 7 / 6;
      } else {
        actionsNeeded = objective - actionsDone;
      }
      timeElem = getTimeElem(actionsNeeded, row.firstChild.className, isVillage ? questInfo.villageSize : 1);
      row.appendChild(timeElem);
      
      //Add ratios
      if(reward[1].toLowerCase() === 'gold') { 
        const ratio = Math.round(parseInt(reward[0]) / objective * 600).toLocaleString();
        row.children[2].innerText = `${row.children[2].innerText} (${ratio} gold/hr)`;
      } else if(!isVillage) {
        const ratio = (parseInt(reward[0]) / objective).toFixed(3);
        row.children[2].innerText = `${row.children[2].innerText} (${ratio})`;
      }
      
      return await getQuestInfoElem(actionsNeeded, questInfo);
      
    } else if(objectiveElemText[3].toLowerCase() === 'base') { //Special case: Exp reward quest
      const goldCollected = parseInt(objectiveElemText[0]);
      const objective = parseInt(objectiveElemText[2]);
      const currentMonster = gameData.playerActionService.selectedMonster;
      const baseGoldPerAction = 8 + 2 * currentMonster;
      const actionsNeeded = Math.ceil((objective - goldCollected) / baseGoldPerAction);
      timeElem = getTimeElem(actionsNeeded, row.firstChild.className, isVillage ? questInfo.villageSize : 1);
      row.appendChild(timeElem);
      
      //Add ratio
      const reward = row.children[2].innerText.split(' ')[0].replace(/,/g, '');
      const ratio = Math.round(parseInt(reward) / actionsNeeded).toLocaleString();
      row.children[2].innerText = `${row.children[2].innerText} (${ratio} exp/action)`;
      return await getQuestInfoElem(actionsNeeded, questInfo);

    } else {
      timeElem = getTimeElem(-1, row.firstChild.className);
      row.appendChild(timeElem);
      return await getQuestInfoElem(-1, questInfo);
    }


  } else if(isVillage && tableBody.children[0]) {
    //Get village quests
    for(let i = 0; i < tableBody.children.length; i++) {
      let row = tableBody.children[i];
      
      const objectiveText = row.children[1].innerText.split(' ');
      let timeElem = null;
      if(objectiveText[1] === 'actions') {
        //Add border if there's a str point reward
        const reward = row.children[2].innerText.split(' ')[1];
        if(reward === 'strength' && parseInt(objectiveText[0]) <= strActions) {
          row.children[2].style.border = 'inset';
        }
        //Insert end time
        const objective = parseInt(objectiveText[0]);
        timeElem = getTimeElem(objective, row.firstChild.className, questInfo.villageSize);
      } else {
        timeElem = getTimeElem(-1, row.firstChild.className);
      }
      row.appendChild(timeElem);
    }
    return;


  } else if(tableBody.children[0]) { //personal not active quests
    const availableQuests = gameData.playerQuestService.questArray;

    //Go through each quest and update row accordingly
    for(let i = 0; i < availableQuests.length; i++) {
      const row = tableBody.children[i];
      let actionsNeeded = -1;

      if(availableQuests[i].type === 'swordsman' || availableQuests[i].type === 'tax' || 
        availableQuests[i].type === 'gems' || availableQuests[i].type === 'spell') { 
        //Above are the quests that require actions to be done
        actionsNeeded = parseInt(availableQuests[i].objective.split(' ')[0].replace(/,/g, ''));

      } else if(availableQuests[i].type === 'treasure') {
        actionsNeeded = parseInt(availableQuests[i].objective.split(' ')[0].replace(/,/g, ''));
        //Insert a gold ratio
        const reward = parseInt(availableQuests[i].reward.split(' ')[0].replace(/,/g, ''));
        const ratio = Math.round(reward / actionsNeeded * 600).toLocaleString();
        row.children[1].innerText = `${row.children[1].innerText} (${ratio} gold/hr)`;

      } else if(availableQuests[i].type === 'slow') {
        //Convert 7 second actions to 6 second actions
        actionsNeeded = parseInt(availableQuests[i].objective.split(' ')[0].replace(/,/g, '')) * 7 / 6;

      } else if(availableQuests[i].type === 'friend') { //Base gold objective
        const goldObjective = parseInt(availableQuests[i].objective.split(' ')[0].replace(/,/g, ''));
        const currentMonster = gameData.playerActionService.selectedMonster;
        actionsNeeded = Math.ceil(goldObjective / (8 + 2 * currentMonster));
        //Insert a exp ratio
        const reward = parseInt(row.children[1].innerText.split(' ')[0].replace(/,/g, ''));
        const ratio = Math.round(reward / actionsNeeded).toLocaleString();
        row.children[1].innerText = `${row.children[1].innerText} (${ratio} exp/action)`;
      } 
      if(row.id !== 'questInfoRow'){
        const timeElem = getTimeElem(actionsNeeded, row.firstChild.className);
        row.appendChild(timeElem);
      }
    }
    return getQuestRatioInfo(questInfo); //The bottom row that contains extra info
  }
}

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
  /**
   * Handle an update on the catacomb page, and insert an end time into the page
   * for any selected catacomb.
  **/
  if ( // skip unnecessary updates 
    mutation?.addedNodes?.[0]?.localName === 'mat-tooltip-component' ||
    mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
    mutation?.addedNodes?.[0]?.nodeName === '#text' ||
    mutation?.addedNodes?.[0]?.id === 'catacombEndTime'
  ) {
    return;
  }
  const mainView = document.querySelector('app-catacomb-main');

  //Check if active or inactive view
  if (mainView.firstChild.nodeName === '#comment') { // Active view
    const parentElement = mainView.firstElementChild.firstChild.firstChild;
    const mobText = parentElement.firstChild.firstChild.firstChild.children[1].innerText;
    const totalMobs = parseInt(mobText.split(' ')[2].replace(/,/g, ''));
    const mobsKilled = parseInt(mobText.split(' ')[0].replace(/,/g, ''));
    const secondsLeft = parseInt(parentElement.children[1].innerText.replace(/,/g, ''));

    // Create the end time ele to insert into
    const endTimeEle = document.getElementById('catacombEndTime') ?? document.createElement('div');
    endTimeEle.id = 'catacombEndTime';
    endTimeEle.setAttribute('class', 'h5');
    endTimeEle.innerText = `| End time: ${getCatacombEndTime(totalMobs - mobsKilled, catacombInfo.actionTimerSeconds, secondsLeft)}`;

    parentElement.appendChild(endTimeEle);

  } else { // Inactive view
    const parentElement = mainView.firstChild.children[1].firstChild.firstChild;
    const totalMobs = parseInt(parentElement.firstChild.children[1].firstChild.children[11].children[1].innerText.replace(/,/g, ''));
    const toInsertIntoEle = parentElement.children[1];
    
    // Create the end time ele to insert into
    const endTimeEle = document.getElementById('catacombEndTime') ?? document.createElement('div');
    endTimeEle.id = 'catacombEndTime';
    endTimeEle.innerText = `End time (local): ${getCatacombEndTime(totalMobs, catacombInfo.actionTimerSeconds)}`;
    toInsertIntoEle.appendChild(endTimeEle);
  }
}

function getCatacombEndTime(numMobs, actionTimerSeconds, extraSeconds=0) {
  const current = new Date();
  const finishTime = new Date(current.getTime() + (numMobs * actionTimerSeconds + extraSeconds) * 1000)
                              .toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
  return finishTime;
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

  async initQuestData() {
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
      let target = document.querySelector('app-catacomb-main')?.firstChild;
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-catacomb-main').firstChild;
      }

      if (target.nodeName === '#comment') { // Active catacomb page
        // Only listen for change in active/inactive state
        this.catacombObserver.observe(target.parentElement, {
          childList: true, subtree: false, attributes: false,
        });

        // Get updated catacomb data before handing it off
        this.catacomb = await getCatacombData();
        handleCatacombPage({target: target}, this.catacomb);

      } else {
        this.catacombObserver.observe(target, {
          childList: true, subtree: true, attributes: false,
        });
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

async function getGameData() { //ULTIMATE POWER
  //Get a reference to *all* the data the game is using to run
  gameData = getAllAngularRootElements()[0].children[2]['__ngContext__'][30]?.playerGeneralService;

  if(!gameData) gameDataAttempts--;

  if (gameDataAttempts <= 0) {
    console.log('QuesBS: Game Data could not be loaded. The script will not work without it. Please refresh the page and try again.');
    clearInterval(gameDataLoader);
  } else if (gameData !== null) {
    clearInterval(gameDataLoader);
  }

}


// This is where the script starts
var QuesBS = null;
console.log('QuesBS: Init load');
let QuesBSLoader = null;
let numAttempts = 30;
let gameDataAttempts = 180;
var gameData = null;
QuesBSLoader = setInterval(setupScript, 3000);
const gameDataLoader = setInterval(getGameData, 500);

window.startQuesBS = () => { // If script doesn't start, call this function (ie. startQuesBS() in the console)
  QuesBSLoader = setInterval(setupScript, 3000);
}

async function setupScript() {
  if(document.getElementById('profile-next-level') && QuesBS === null && gameData !== null) {
    QuesBS = new Script();
    console.log('QuesBS: The script has been loaded.');

    clearInterval(QuesBSLoader);
    await QuesBS.initPathDetection();
    await QuesBS.initQuestData();
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