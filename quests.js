async function updateQuestData(gameData) {
  // A function to be called when the game loads in
  let quest = {};
  //Couldn't find an easier method to get quest completions than a POST request
  gameData.httpClient.post('/player/load/misc', {}).subscribe(
    val => {
      quest.questsCompleted = val.playerMiscData.quests_completed;
      quest.playerId = val.playerMiscData.player_id;
    },
    response => console.log('QuesBS: POST request failure', response)
  );

  quest = {...quest, ...await getPlayerRefreshes(gameData, quest)};

  if(gameData.playerVillageService?.isInVillage === true) {
    let villageService = gameData.playerVillageService;
    //Wait for service to load
    while(villageService === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
      villageService = gameData.playerVillageService;
    }
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

async function getVillageRefreshes(gameData) {
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
    min: Math.round((quest.questsCompleted/300+this.quest.baseStat+8.5)*(1+quest.villageBold*2/100)*1.09),
  }
}


/*** Observer triggers ***/ 
async function handlePersonalQuest(mutation) {
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
    this.addEndTimeColumn(questTable);

    const tableBody = questTable.children[1];

    //There are two states: active quest and no quest
    if(tableBody.children.length > 2) {//No quest
      //Get the info row that goes at the bottom
      infoRow = await this.insertEndTimeElem(tableBody, false, false);

    } else if(tableBody.children.length > 0) { //Active quest
      //Update number of refreshes used, just in case
      await this.updateRefreshes();
      infoRow = await this.insertEndTimeElem(tableBody, false, true);

    } else {
      return;
    }

    //Add an extra row for extra quest info if there isn't one already
    if(!document.getElementById('questInfoRow')) tableBody.appendChild(infoRow);
  }
}

async function handleVillageQuest(mutation) {
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
    this.addEndTimeColumn(questTable);

    //Add end time
    const tableBody = questTable.children[1];

    //Add end time elems to the end time column
    if(tableBody.children.length > 2) { //Quest is not active
      await this.insertEndTimeElem(tableBody, true, false);
    } else { //Quest is active
      await this.insertEndTimeElem(tableBody, true, true);
    }

    //Add info text at the bottom of quest table
    const infoRow = document.createTextNode('End time is calculated assuming all members are active. The time is approximate and may not be accurate.'
      + `${this.quest.villageRefreshesUsed}/${this.quest.villageNumRefreshes} refreshes used.`);
    infoRow.id = 'questExplanation';
    if(questTable.parentElement.lastChild.id !== 'questExplanation') {
      questTable.parentElement.appendChild(infoRow);
    }
  }
}


/*** ELEMENT CREATION ***/
async function getQuestInfoElem(actionsNeeded) {
  /**
   * Returns the info row used for active personal quest page
   */
  const partyActions = await this.getPartyActions();
  let row = document.createElement('tr');

  const date = new Date();
  //actionsNeeded * 6000 = actions * 6 sec per action * 1000 milliseconds
  const finishPartyTime = new Date(date.getTime() + (actionsNeeded + partyActions) * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
  const info = ['',`${this.quest.refreshesUsed}/${this.quest.numRefreshes} refreshes used`, '',
    actionsNeeded >= 0 ? `End time (local time) with ${partyActions} party actions: ${finishPartyTime}`: ''];
  let htmlInfo = '';
  for (let text of info) {
    htmlInfo += `<td>${text}</td>`
  }
  row.innerHTML = htmlInfo;
  row.id = 'questInfoRow';
  return row;
}

function getTimeElem(actionsNeeded, className, isVillage=true) {
  /**
   * Returns an element used to describe the end time for each quest, used for
   * the end time column. It has styled CSS through the className, and the
   * time calculation differs for village vs personal. If there are an 
   * invalid number of actionsNeeded, the time is N/A.
   */
  const cell = document.createElement('td');

  if(actionsNeeded > 0) {
    const date = new Date();
    const numPeople = isVillage ? this.quest.villageSize : 1;
    //actionsNeeded * 6 sec per action * 1000 milliseconds / numPeople
    const finishTime = new Date(date.getTime() + actionsNeeded * 6000 / numPeople).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
    cell.innerText = finishTime;
  } else {
    cell.innerText = 'N/A';
  }
  cell.setAttribute('class', className);
  return cell;
}

function getQuestRatioInfo() {
  //Return info row used for inactive personal quests
  let row = document.createElement('tr');
  const stat = this.getStatReward();
  const avg = (stat.max/this.quest.minActions + stat.min/this.quest.maxActions) / 2;
  const info = ['Possible stat ratios, considering quests completed & village bold:',
  `Worst ratio: ${(stat.min/this.quest.maxActions).toFixed(3)}`,
  `Avg ratio: ${(avg).toFixed(3)}`,
  `Best Ratio: ${(stat.max/this.quest.minActions).toFixed(3)}`,
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

async function insertEndTimeElem(tableBody, isVillage, isActiveQuest) {
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
      timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, isVillage);
      row.appendChild(timeElem);
      
      //Add ratios
      if(reward[1].toLowerCase() === 'gold') { 
        const ratio = Math.round(parseInt(reward[0]) / objective * 600).toLocaleString();
        row.children[2].innerText = `${row.children[2].innerText} (${ratio} gold/hr)`;
      } else if(!isVillage) {
        const ratio = (parseInt(reward[0]) / objective).toFixed(3);
        row.children[2].innerText = `${row.children[2].innerText} (${ratio})`;
      }
      
      return await this.getQuestInfoElem(actionsNeeded);
      
    } else if(objectiveElemText[3].toLowerCase() === 'base') { //Special case: Exp reward quest
      const goldCollected = parseInt(objectiveElemText[0]);
      const objective = parseInt(objectiveElemText[2]);
      const currentMonster = this.gameData.playerActionService.selectedMonster;
      const baseGoldPerAction = 8 + 2 * currentMonster;
      const actionsNeeded = Math.ceil((objective - goldCollected) / baseGoldPerAction);
      timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, isVillage);
      row.appendChild(timeElem);
      
      //Add ratio
      const reward = row.children[2].innerText.split(' ')[0].replace(/,/g, '');
      const ratio = Math.round(parseInt(reward) / actionsNeeded).toLocaleString();
      row.children[2].innerText = `${row.children[2].innerText} (${ratio} exp/action)`;
      return await this.getQuestInfoElem(actionsNeeded);

    } else {
      timeElem = this.getTimeElem(-1, row.firstChild.className, isVillage);
      row.appendChild(timeElem);
      return await this.getQuestInfoElem(-1);
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
        if(reward === 'strength' && parseInt(objectiveText[0]) <= this.settings.strActions) {
          row.children[2].style.border = 'inset';
        }
        //Insert end time
        const objective = parseInt(objectiveText[0]);
        timeElem = this.getTimeElem(objective, row.firstChild.className, true);
      } else {
        timeElem = this.getTimeElem(-1, row.firstChild.className, true);
      }
      row.appendChild(timeElem);
    }
    return;


  } else if(tableBody.children[0]) { //personal not active quests
    const availableQuests = this.gameData.playerQuestService.questArray;

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
        const currentMonster = this.gameData.playerActionService.selectedMonster;
        actionsNeeded = Math.ceil(goldObjective / (8 + 2 * currentMonster));
        //Insert a exp ratio
        const reward = parseInt(row.children[1].innerText.split(' ')[0].replace(/,/g, ''));
        const ratio = Math.round(reward / actionsNeeded).toLocaleString();
        row.children[1].innerText = `${row.children[1].innerText} (${ratio} exp/action)`;
      } 
      if(row.id !== 'questInfoRow'){
        const timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, false);
        row.appendChild(timeElem);
      }
    }
    return this.getQuestRatioInfo(); //The bottom row that contains extra info
  }
}

async function insertVillageSettingsElem() {
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
      this.gameData.snackbarService.openSnackbar('Error: Value should be a number'); //feedback popup
    } else {
      this.settings.strActions = newActions;
      localStorage.setItem('QuesBS_settings', JSON.stringify(this.settings));
      this.gameData.snackbarService.openSnackbar('Settings saved successfully'); //feedback popup
    }
  }
  settingsOverview.appendChild(questSettings);
}