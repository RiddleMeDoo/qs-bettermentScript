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