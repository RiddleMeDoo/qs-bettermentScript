// ==UserScript==
// @name         Queslar Betterment Script
// @namespace    https://www.queslar.com
// @version      1.3.0
// @description  A script that lets you know more info about quests
// @author       RiddleMeDoo
// @include      *queslar.com*
// @grant        none
// ==/UserScript==

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
    this.playerId;

    //observer setup
    this.initObservers();
    this.currentPath = window.location.hash.split("/").splice(2).join();
  }

  async getGameData() { //ULTIMATE POWER
    //Get an update of the game's state
    let rootElement = getAllAngularRootElements()[0].children[1]["__ngContext__"][30];
    while(rootElement === undefined) { //Power comes with a price; wait for it to load
      await new Promise(resolve => setTimeout(resolve, 500))
      rootElement = getAllAngularRootElements()[0].children[1]["__ngContext__"][30];
    }
    return rootElement.playerGeneralService;
  }

  async updateQuestData() {
    let gameData = await this.getGameData();
    //Couldn't find an easier method than doing a POST request
    gameData.httpClient.post('/player/load/misc', {}).subscribe(
      val => {
        this.quest.questsCompleted = val.playerMiscData.quests_completed;
        this.playerId = val.playerMiscData.player_id;
      },
      response => console.log('QBS: POST request failure', response)
    );

    await this.updateRefreshes();
    if(gameData.playerVillageService?.isInVillage === true) {
      let villageService = gameData.playerVillageService;
      //Wait for service to load
      while(villageService === undefined) {
        await new Promise(resolve => setTimeout(resolve, 200));
        villageService = gameData.playerVillageService;
      }
      this.quest.villageBold = villageService.strengths.bold.amount;
      this.quest.villageSize = villageService.general.members.length;
      this.quest.villageNumRefreshes = villageService.general.dailyQuestsBought + 5;
      this.quest.villageRefreshesUsed = villageService.general.dailyQuestsUsed;
    }
    //Can't be bothered to calculate it accurately using all 4 stats
    this.quest.baseStat = Math.min(15, gameData.playerStatsService?.strength * 0.0025);
  }

  async getPartyActions() {
    let gameData = await this.getGameData();
    //Wait for service to load
    while(gameData?.partyService?.partyOverview?.partyInformation === undefined) {
      await new Promise(resolve => setTimeout(resolve, 500));
      gameData = await this.getGameData();
    }

    return gameData.partyService.partyOverview.partyInformation[this.playerId].actions.daily_actions_remaining;
  }

  async updateRefreshes() {
    let gameData = await this.getGameData();
    //Wait for service to load
    while(gameData?.playerQuestService?.refreshesUsed === undefined) {
      await new Promise(resolve => setTimeout(resolve, 500));
      gameData = await this.getGameData();
    }
    this.quest.numRefreshes = gameData.playerQuestService.refreshesBought + 20;
    this.quest.refreshesUsed = gameData.playerQuestService.refreshesUsed;
  }

  async updateVillageRefreshes() {
    let gameData = await this.getGameData();
    let villageService = gameData.playerVillageService;
    this.quest.villageNumRefreshes = villageService.general.dailyQuestsBought + 5;
    this.quest.villageRefreshesUsed = villageService.general.dailyQuestsUsed;
  }

  initObservers() {
    let scriptObject = this; //mutation can't keep track of this
    this.personalQuestObserver = new MutationObserver(mutationsList => {
      scriptObject.handlePersonalQuest(mutationsList[0]);
    });
    this.villageQuestObserver = new MutationObserver(mutationsList => {
      scriptObject.handleVillageQuest(mutationsList[0]);
    })
  }


  async initPathDetection() {
    let gameData = await this.getGameData();
    let router = gameData?.router
    //Wait for service to load
    while(router === undefined && router?.events === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
      router = gameData.router
    }
    gameData.router.events.subscribe(event => {
      if(event.navigationTrigger) this.handlePathChange(event.url);
    });
  }


  async handlePathChange(url) {
    const path = url.split("/").slice(2);
    if(path.join() !== this.currentPath) {
      this.stopObserver(this.currentPath);
    }
    this.currentPath = path.join();
    //Activate observer if on a specific page
    if(path[path.length - 1].toLowerCase() === 'quests' && path[0].toLowerCase() === 'actions') {
      let target = document.querySelector('app-actions');
      //Sometimes the script attempts to search for element before it loads in
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-actions');
      }
      this.personalQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });

    } else if(path[path.length - 1].toLowerCase() === 'quests' && path[0].toLowerCase() === 'village') {
      let target = document.querySelector('app-village');
      //Sometimes the script attempts to search for element before it loads in
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = document.querySelector('app-village');
      }
      this.villageQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
    }
  }

  async handlePersonalQuest(mutation) {
    //Filter out any unneeded mutations
    if(mutation?.addedNodes?.length < 1 ||
      mutation?.addedNodes?.[0]?.localName === 'mat-tooltip-component' ||
      mutation?.addedNodes?.[0]?.nodeName === 'TH' ||
      mutation?.addedNodes?.[0]?.nodeName === 'TD' ||
      mutation?.addedNodes?.[0]?.nodeName === '#text' ||
      mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
      mutation?.addedNodes?.[0]?.id === "questInfoRow") {
      return;
    }
    const questTable = mutation.target.parentElement.tagName === 'TABLE' ? mutation.target.parentElement : mutation.target.querySelector('table');

    if(questTable) {
      let infoRow = null;

      //Add end time column to table
      this.addEndTimeColumn(questTable);

      const tableBody = questTable.children[1];

      //There are two states: active quest and no quest
      if(tableBody.children.length > 2) {//No quest
        infoRow = await this.insertEndTimeElem(tableBody, false, false);

      } else if(tableBody.children.length > 0) { //Active quest
        //Update number of refreshes used, just in case
        await this.updateRefreshes();
        infoRow = await this.insertEndTimeElem(tableBody, false, true);
        //Special case: Gold reward quest
        const rewardText = tableBody.children[0].children[2].innerText;
        const reward = rewardText.split(" ");
        if(reward[1].toLowerCase() === "gold") {
          //Add a gold ratio
          const actionsNeeded = parseInt(tableBody.children[0].children[1].innerText.split(" ")[2]);
          const ratio = Math.round(parseInt(reward[0]) / actionsNeeded * 600).toLocaleString();
          tableBody.children[0].children[2].innerText = `${rewardText} (${ratio} gold/hr)`;
        }
      } else {
        return;
      }

      //Add an extra row for extra quest info if there isn't one already
      if(!document.getElementById('questInfoRow')) tableBody.appendChild(infoRow);
    }
  }


  async handleVillageQuest(mutation) {
    if(mutation?.addedNodes?.length < 1 ||
      mutation?.addedNodes?.[0]?.nodeName === '#text' ||
      mutation?.addedNodes?.[0]?.nodeName === 'TH' ||
      mutation?.addedNodes?.[0]?.nodeName === 'TD' ||
      mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
      mutation?.addedNodes?.[0]?.id === "questInfoRow") {
      return;
    }
    const questTable = mutation.target.parentElement.tagName === 'TABLE' ? mutation.target.parentElement : mutation.target.querySelector('table');

    if(questTable) {
      await this.updateVillageRefreshes(); //Update for refreshes used
      this.addEndTimeColumn(questTable);

      //Add end time
      const tableBody = questTable.children[1];

      //Add end time elems to the end time column
      if(tableBody.children.length > 2) { //Quest is not active
        await this.insertEndTimeElem(tableBody, true, false);
      } else {
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

  stopObserver(pathname) {
    const stop = {
      'actions,quests': () => this.personalQuestObserver.disconnect(),
      'village,quests': () => this.villageQuestObserver.disconnect(),
    }
    if(stop[pathname]) stop[pathname]();
  }

  getStatReward() {
    return {
      max: Math.round((this.quest.questsCompleted/300+this.quest.baseStat+22.75)*(1+this.quest.villageBold*2/100)*1.09),
      min: Math.round((this.quest.questsCompleted/300+this.quest.baseStat+8.5)*(1+this.quest.villageBold*2/100)*1.09),
    }
  }

  async getQuestInfoElem(actionsNeeded) {
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

  getTimeElem(actionsNeeded, className, isVillage=true) {
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

  getQuestRatioInfo() {
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

  addEndTimeColumn(tableElem) {
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

  async insertEndTimeElem(tableBody, isVillage, isActiveQuest) {
    /* Returns info row because I suck at structure */
    //First, determine if quest is active
    if(isActiveQuest && tableBody.children[0]) {
      //If it is, parse the text directly
      const row = tableBody.children[0];
      const objectiveElemText = row?.children[1].innerText.split(" ");
      let timeElem;
      if(objectiveElemText[3].toLowerCase() === "actions" || objectiveElemText[3].toLowerCase() === "survived") {
        const actionsDone = parseInt(objectiveElemText[0]);
        const objective = parseInt(objectiveElemText[2]);
        //Special case: Party action quest (because it has 7 sec timer)
        if(row.children[2].innerText.split(" ")[1].toLowerCase() === "party") {
          const convertedActions = (objective - actionsDone) * 7 / 6;
          timeElem = this.getTimeElem(convertedActions, row.firstChild.className, isVillage);
          row.appendChild(timeElem);
          return await this.getQuestInfoElem(convertedActions);
        } else {
          timeElem = this.getTimeElem(objective - actionsDone, row.firstChild.className, isVillage);
          row.appendChild(timeElem);
          return await this.getQuestInfoElem(objective - actionsDone);
        }
      } else {
        timeElem = this.getTimeElem(-1, row.firstChild.className, isVillage);
        row.appendChild(timeElem);
        return await this.getQuestInfoElem(-1);
      }
    } else if(isVillage && tableBody.children[0]) {
      //Get village quests
      for(let i = 0; i < tableBody.children.length; i++) {
        let row = tableBody.children[i];
        
        const objectiveText = row.children[1].innerText.split(" ");
        let timeElem = null;
        if(objectiveText[1] === "actions") {
          //Check for str point reward
          const reward = row.children[2].innerText.split(" ")[1];
          if(reward === "strength") {
            row.children[2].style.border = "inset";
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
      //Get list of quests available
      let gameData = await this.getGameData();

      while(gameData?.playerQuestService?.questList === undefined) { //Wait for service to load
        await new Promise(resolve => setTimeout(resolve, 200));
        gameData = await this.getGameData();
      }

      const availableQuests = gameData.playerQuestService.questArray;

      //Go through each quest and update row accordingly
      for(let i = 0; i < availableQuests.length; i++) {
        const row = tableBody.children[i];
        if(availableQuests[i].type === "swordsman" || availableQuests[i].type === "tax" || 
          availableQuests[i].type === "gems" || availableQuests[i].type === "spell") { 
          //Above are the quests that require actions to be done
          const actionsNeeded = parseInt(availableQuests[i].objective.split(" ")[0].replace(/,/g, ""));
          const timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, false);
          row.appendChild(timeElem); //Insert end time
        } else if(availableQuests[i].type === "treasure") {
          //Add a gold ratio
          const actionsNeeded = parseInt(availableQuests[i].objective.split(" ")[0].replace(/,/g, ""));
          const reward = parseInt(availableQuests[i].reward.split(" ")[0].replace(/,/g, ""));
          const ratio = Math.round(reward / actionsNeeded * 600).toLocaleString();
          const timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, false);
          row.appendChild(timeElem); //Insert end time
          //Insert ratio
          row.children[1].innerText = `${row.children[1].innerText} (${ratio} gold/hr)`
        } else if(availableQuests[i].type === "slow") {
          //Convert 7 second actions to 6 second actions
          const actionsNeeded = parseInt(availableQuests[i].objective.split(" ")[0].replace(/,/g, ""));
          const convertedActions = actionsNeeded * 7 / 6;
          const timeElem = this.getTimeElem(convertedActions, row.firstChild.className, false);
          row.appendChild(timeElem);
        } else if(row.id !== 'questInfoRow'){ //Time not able to be calculated
          const timeElem = this.getTimeElem(-1, row.firstChild.className, false);
          row.appendChild(timeElem);
        }
      }
      return this.getQuestRatioInfo(); //The bottom row that contains extra info
    }
  }
}


// This is where the script starts
var QBS = null;
console.log('QBS: Init load');
let QBSLoader = null;
let numAttempts = 30;

window.addEventListener('load', () => { //Load the page first before setting up the script
  QBSLoader = setInterval(setupScript, 3000);
});

async function setupScript() {
  if(document.getElementById('profile-next-level') && QBS === null) {
    QBS = new Script();
    console.log('QBS: The script has been loaded.');

    clearInterval(QBSLoader);
    await QBS.initPathDetection();
    await QBS.updateQuestData();
  } else {
    console.log('QBS: Loading failed. Trying again...');
    numAttempts--;
    if(numAttempts <= 0) {
      clearInterval(QBSLoader); //Stop trying after a while
      console.log('QBS: Loading failed. Stopping...');
    }
  }
}