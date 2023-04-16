// ==UserScript==
// @name         Queslar Betterment Script
// @namespace    https://www.queslar.com
// @version      1.6.0
// @description  A script that lets you know more info about quests
// @author       RiddleMeDoo
// @include      *queslar.com*
// @require      https://code.jquery.com/jquery-3.6.3.slim.min.js
// @resource     settingsMenu https://raw.githubusercontent.com/RiddleMeDoo/qs-bettermentScript/tooltips/tomeSettingsPopup.html
// @grant        GM_addStyle
// @grant        GM_getResourceText
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
    this.villageSettings = JSON.parse(localStorage.getItem('QuesBS_villageSettings')) ?? {
      strActions: 30000
    };
    this.tomeSettings = JSON.parse(localStorage.getItem('QuesBS_tomeSettings')) ?? {
      highlightReward: 10000,
      highlightMob: 10000,
      highlightCharacter: 10000,
      highlightElementalConv: 10000,
    };
    this.catacomb = {
      villageActionSpeed: 0,
      actionTimerSeconds: 30,
    }
    this.playerId;
    this.gameData;

    //observer setup
    this.initObservers();
    this.currentPath = window.location.hash.split('/').splice(2).join();
  }

  playAudio() {
    this.eventAudio.play();
  }

  async getGameData() { //ULTIMATE POWER
    let tries = 30;
    //Get a reference to *all* the data the game is using to run
    this.gameData = getAllAngularRootElements()[0].children[2]['__ngContext__'][30]?.playerGeneralService;
    while(this.gameData === undefined && tries > 0) { //Power comes with a price; wait for it to load
      await new Promise(resolve => setTimeout(resolve, 500))
      this.gameData = getAllAngularRootElements()[0].children[2]['__ngContext__'][30]?.playerGeneralService;
      tries--;
    }

    if (tries <= 0) {
      console.log('QuesBS: Could not load gameData.');
    }
  }

  async updateCatacombData() {
    /***
     * Returns Observatory boost, action timer in seconds
    ***/
    // Wait until services load
    while(this.gameData?.playerCatacombService === undefined || this.gameData?.playerVillageService === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const tomes = this.gameData.playerCatacombService.calculateTomeOverview();
    const villageService = this.gameData.playerVillageService;

    let villageActionSpeedBoost;
    if (villageService?.isInVillage === true) {
      const level = villageService?.buildings?.observatory?.amount ?? 0;
      villageActionSpeedBoost = (Math.floor(level / 20) * Math.floor(level / 20 + 1) / 2 * 20 + (level % 20) * Math.floor(level / 20 + 1)) / 100;
    } else {
      villageActionSpeedBoost = 0;
    }

    this.catacomb = {
      villageActionSpeed: villageActionSpeedBoost,
      actionTimerSeconds: 30 / (1 + villageActionSpeedBoost + tomes.speed / 100),
    }
  }

  async updateQuestData() {
    //Couldn't find an easier method to get quest completions than a POST request
    this.gameData.httpClient.post('/player/load/misc', {}).subscribe(
      val => {
        this.quest.questsCompleted = val.playerMiscData.quests_completed;
        this.playerId = val.playerMiscData.player_id;
      },
      response => console.log('QuesBS: POST request failure', response)
    );

    await this.updateRefreshes();
    if(this.gameData.playerVillageService?.isInVillage === true) {
      let villageService = this.gameData.playerVillageService;
      //Wait for service to load
      while(villageService === undefined) {
        await new Promise(resolve => setTimeout(resolve, 200));
        villageService = this.gameData.playerVillageService;
      }
      this.quest.villageBold = villageService.strengths.bold.amount;
      this.quest.villageSize = villageService.general.members.length;
      this.quest.villageNumRefreshes = villageService.general.dailyQuestsBought + 5;
      this.quest.villageRefreshesUsed = villageService.general.dailyQuestsUsed;
    }
    //Can't be bothered to calculate it accurately using all 4 stats
    this.quest.baseStat = Math.min(15, this.gameData.playerStatsService?.strength * 0.0025);
  }

  async getPartyActions() {
    //A function to wait for party service to load
    //And also to abstract the horribly long method
    while(this.gameData?.partyService?.partyOverview?.partyInformation === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return this.gameData.partyService.partyOverview.partyInformation[this.playerId].actions.daily_actions_remaining;
  }

  async updateRefreshes() {
    //Only made a load waiter because script was having issues with not loading
    while(this.gameData?.playerQuestService?.refreshesUsed === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    this.quest.numRefreshes = this.gameData.playerQuestService.refreshesBought + 20;
    this.quest.refreshesUsed = this.gameData.playerQuestService.refreshesUsed;
  }

  async updateVillageRefreshes() {
    let villageService = this.gameData.playerVillageService;
    this.quest.villageNumRefreshes = villageService.general.dailyQuestsBought + 5;
    this.quest.villageRefreshesUsed = villageService.general.dailyQuestsUsed;
  }

  initObservers() {
    /**
     * Initialize observers which will be used to detect changes on
     * each specific page when it updates.
     */
    let scriptObject = this; //mutation can't keep track of this
    this.personalQuestObserver = new MutationObserver(mutationsList => {
      scriptObject.handlePersonalQuest(mutationsList[0]);
    });
    this.villageQuestObserver = new MutationObserver(mutationsList => {
      scriptObject.handleVillageQuest(mutationsList[0]);
    });
    this.catacombObserver = new MutationObserver(mutationsList => {
      this.handleCatacombPage(mutationsList[0]);
    });
    this.tomeObserver = new MutationObserver(mutationsList => {
      this.handleCatacombTomeStore(mutationsList[0]);
    });
  }


  async initPathDetection() {
    /**
     * Initializes the event trigger that will watch for changes in the
     * url path. This will allow us to determine which part of the
     * script to activate on each specific page.
     */
    let router = this.gameData?.router
    //Wait for service to load
    while(router === undefined && router?.events === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
      router = this.gameData.router
    }
    this.gameData.router.events.subscribe(event => {
      if(event.navigationTrigger) this.handlePathChange(event.url);
    });

    //Send a popup to player as feedback
    this.gameData.snackbarService.openSnackbar('QuesBS has been loaded.');
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
        await new Promise(resolve => setTimeout(resolve, 50))
        target = document.querySelector('app-actions');
      }
      this.personalQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
      //Sometimes there is no change observed for the initial page load, so call function
      await this.handlePersonalQuest({target: target});


    } else if(path[path.length - 1].toLowerCase() === 'quests' && path[0].toLowerCase() === 'village') {
      //Observe village quest page for updates
      let target = document.querySelector('app-village');
      //Sometimes the script attempts to search for element before it loads in
      while(!target) {
        await new Promise(resolve => setTimeout(resolve, 50))
        target = document.querySelector('app-village');
      }
      this.villageQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
      //Sometimes there is no change observed for the initial page load, so call function
      await this.handleVillageQuest({target: target});


    } else if(path[path.length - 1].toLowerCase() === 'settings' && path[0].toLowerCase() === 'village') {
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
        this.updateCatacombData(); // ! This might cause some issues with concurrency
        this.handleCatacombPage({target: target});

      } else {
        // Get updated catacomb data before handing it off
        this.updateCatacombData(); // ! This might cause some issues with concurrency
        this.catacombObserver.observe(target, {
          childList: true, subtree: true, attributes: false,
        });
      }
    } else if(path[path.length - 1].toLowerCase() === 'tome_store' && path[0].toLowerCase() === 'catacombs') {
      await this.insertTomeSettings();

      let target = $('app-catacomb-tome-store > .scrollbar > div > div > .d-flex.flex-wrap.gap-1');
      while(target.length < 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = $('app-catacomb-tome-store > .scrollbar > div > div > .d-flex.flex-wrap.gap-1');
      }

      this.tomeObserver.observe(target[0], {
        childList: true, subtree: false, attributes: false
      });
      this.handleCatacombTomeStore({target: target[0]});
    }
  }


  async handlePersonalQuest(mutation) {
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


  async handleVillageQuest(mutation) {
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
      await this.updateVillageRefreshes(); //Update for refreshes used
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

  async handleCatacombPage(mutation) {
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
      endTimeEle.innerText = `| End time: ${getCatacombEndTime(totalMobs - mobsKilled, this.catacomb.actionTimerSeconds, secondsLeft)}`;

      parentElement.appendChild(endTimeEle);

    } else { // Inactive view
      const parentElement = mainView.firstChild.children[1].firstChild.firstChild;
      const totalMobs = parseInt(parentElement.firstChild.children[1].firstChild.children[11].children[1].innerText.replace(/,/g, ''));
      const toInsertIntoEle = parentElement.children[1];

      // Create the end time ele to insert into
      const endTimeEle = document.getElementById('catacombEndTime') ?? document.createElement('div');
      endTimeEle.id = 'catacombEndTime';
      endTimeEle.innerText = `End time (local): ${getCatacombEndTime(totalMobs, this.catacomb.actionTimerSeconds)}`;
      toInsertIntoEle.appendChild(endTimeEle);

      // Create tooltips for gold/hr and emblems/hr
      const goldEle = parentElement.firstChild.children[1].firstChild.children[9].children[1];
      const emblemsEle = parentElement.firstChild.children[1].firstChild.children[10].children[1];
      const goldHr = parseInt(goldEle.innerText.replace(/,/g, '')) / this.catacomb.actionTimerSeconds * 3600;
      goldEle.parentElement.setAttribute('title', `${goldHr.toLocaleString(undefined, {maximumFractionDigits:2})}/Hr`);
      const emblemsHr = parseInt(emblemsEle.innerText.replace(/,/g, '')) / totalMobs / this.catacomb.actionTimerSeconds * 3600;
      emblemsEle.parentElement.setAttribute('title', `${emblemsHr.toLocaleString(undefined, {maximumFractionDigits:2})}/Hr`);
    }
  }

  async handleCatacombTomeStore(mutation) {
    /**
     * Add highlights around tomes with good boosts.
     *
    **/
    if ( // skip unnecessary updates
      mutation?.addedNodes?.[0]?.localName === 'mat-tooltip-component' ||
      mutation?.addedNodes?.[0]?.className === 'mat-ripple-element' ||
      mutation?.addedNodes?.[0]?.nodeName === '#text' ||
      mutation?.addedNodes?.[0]?.id === 'highlight'
    ) {
      return;
    }
    const tomeElements = $('app-catacomb-tome-store > .scrollbar > div > div > .d-flex.flex-wrap.gap-1 > div');
    let tomes = this.gameData.playerCatacombService?.tomeStore;
    while (this.gameData.playerCatacombService === undefined || tomes === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200))
      tomes = this.gameData.playerCatacombService?.tomeStore;
    }
    // Put an id on the first tome of the store
    tomeElements[0].id = 'highlight';

    // For each tome (loop by index), check if tome has positive modifiers.
    for (let i = 0; i < tomes.length; i++) {
      const tomeMods = tomes[i];
      const tomeElement = tomeElements[i].firstChild;

      // Check ele conversion highlighting requirements
      if (tomeMods.space_requirement < 4 && tomeMods.elemental_conversion > this.tomeSettings.highlightElementalConv && tomeMods.character_multiplier >= 0) {
        const isDouble = tomeMods.elemental_conversion >= this.tomeSettings.highlightElementalConv * 2;
        tomeElement.children[11].style.border = `${isDouble ? 'thick' : 'thin'} solid`;
        tomeElement.children[11].style.borderColor = tomeElement.children[11].firstChild.style.color;
        if (tomeMods.character_multiplier > this.tomeSettings.highlightCharacter) {
            const isDouble = tomeMods.character_multiplier >= this.tomeSettings.highlightCharacter * 2;
            tomeElement.children[5].style.border = `${isDouble ? 'thick' : 'thin'} solid`;
            tomeElement.children[5].style.borderColor = tomeElement.children[5].firstChild.style.color;
        }
      }

      // If boosts are negative, skip
      if (tomeMods.reward_multiplier < 0 || tomeMods.mob_multiplier < 0 || tomeMods.character_multiplier < 0 ||
          tomeMods.lifesteal < 0 || tomeMods.speed < 0
      ) {
          continue;
      }

      // Highlight positive modifiers
      if (tomeMods.reward_multiplier >= this.tomeSettings.highlightReward) {
        const isDouble = tomeMods.reward_multiplier >= this.tomeSettings.highlightReward * 2;
        tomeElement.children[3].style.border = `${isDouble ? 'thick' : 'thin'} solid`;
        tomeElement.children[3].style.borderColor = tomeElement.children[3].firstChild.style.color;
      }
      if (tomeMods.mob_multiplier > this.tomeSettings.highlightMob) {
        const isDouble = tomeMods.mob_multiplier >= this.tomeSettings.highlightMob * 2;
        tomeElement.children[4].style.border = `${isDouble ? 'thick' : 'thin'} solid`;
        tomeElement.children[4].style.borderColor = tomeElement.children[4].firstChild.style.color;
      }
      if (tomeMods.character_multiplier > this.tomeSettings.highlightCharacter) {
        const isDouble = tomeMods.character_multiplier >= this.tomeSettings.highlightCharacter * 2;
        tomeElement.children[5].style.border = `${isDouble ? 'thick' : 'thin'} solid`;
        tomeElement.children[5].style.borderColor = tomeElement.children[5].firstChild.style.color;
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
    /**
     * Returns the possible max and min values for stat quests
     */
    return {
      max: Math.round((this.quest.questsCompleted/300+this.quest.baseStat+22.75)*(1+this.quest.villageBold*2/100)*1.09),
      min: Math.round((this.quest.questsCompleted/300+this.quest.baseStat+8.5)*(1+this.quest.villageBold*2/100)*1.09),
    }
  }

  async getQuestInfoElem(actionsNeeded) {
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

  getTimeElem(actionsNeeded, className, isVillage=true) {
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

  getQuestRatioInfo() {
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
          if(reward === 'strength' && parseInt(objectiveText[0]) <= this.villageSettings.strActions) {
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
    questSettings.firstChild.children[1].children[1].firstChild.value = this.villageSettings.strActions;
    questSettings.firstChild.children[1].children[1].firstChild.style.width = '6em';
    questSettings.firstChild.children[2].firstChild.firstChild.innerText = 'Save QuesBS Quests';
    //Add a save function for button
    questSettings.firstChild.children[2].firstChild.onclick = () => {
      const newActions = parseInt(document.getElementById('actionsLimitSetting').firstChild.value);
      //Data validation
      if(isNaN(newActions)) {
        this.gameData.snackbarService.openSnackbar('Error: Value should be a number'); //feedback popup
      } else {
        this.villageSettings.strActions = newActions;
        localStorage.setItem('QuesBS_villageSettings', JSON.stringify(this.villageSettings));
        this.gameData.snackbarService.openSnackbar('Settings saved successfully'); //feedback popup
      }
    }
    settingsOverview.appendChild(questSettings);
  }
  
  async insertTomeSettings() {
    /**
     * Inserts a custom popup menu for tome settings
     */  
    //Get store page contents
    let tomeStoreOverview = document.querySelector('app-catacomb-tome-store');
    while(!tomeStoreOverview) {
      await new Promise(resolve => setTimeout(resolve, 50));
      tomeStoreOverview = document.querySelector('app-catacomb-tome-store');
    }
    const settings = document.createElement('div')
    settings.id = 'highlightTomeSettings';
    settings.style.margin = 'auto';
    settings.innerHTML = GM_getResourceText('settingsMenu');
    const openTomeSettingsbutton = document.createElement('button');
    openTomeSettingsbutton.id = 'openTomeSettingsButton';
    openTomeSettingsbutton.className = 'mat-focus-indicator mat-raised-button mat-button-base';
    openTomeSettingsbutton.innerText = 'QuesBS Tome Settings';
    settings.insertBefore(openTomeSettingsbutton, settings.childNodes[0]);
    tomeStoreOverview.firstChild.appendChild(settings);

    // Set up buttons
    openTomeSettingsbutton.onclick = () => {
      document.querySelector('#tomeSettingsContainer').style.display = 'inline-grid';
    };
    document.querySelector('#tomeSettingsCancelButton').onclick = () => {
      document.querySelector('#tomeSettingsContainer').style.display = 'none';
    }
  }
}

// ----------------------------------------------------------------------------
// Helper functions

function getCatacombEndTime(numMobs, actionTimerSeconds, extraSeconds=0) {
  const current = new Date();
  const finishTime = new Date(current.getTime() + (numMobs * actionTimerSeconds + extraSeconds) * 1000)
                              .toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
  return finishTime;
}

// ----------------------------------------------------------------------------

// This is where the script starts
var QuesBS = null;
console.log('QuesBS: Init load');
let QuesBSLoader = null;
let numAttempts = 30;
QuesBSLoader = setInterval(setupScript, 3000);

window.startQuesBS = () => { // If script doesn't start, call this function (ie. startQuesBS() in the console)
  QuesBSLoader = setInterval(setupScript, 3000);
}

window.restartQuesBS = () => { // Try to reload the game data for the script
  QuesBSLoader = setInterval(async () => {
    if (QuesBS.gameData === undefined) {
      await QuesBS.getGameData();
    } else {
      clearInterval(QuesBSLoader);
      console.log('QuesBS: Script has been reloaded.')
    }
  }, 3000);
 }

 async function setupScript() {
  if(QuesBS === null) {
    QuesBS = new Script();
    await QuesBS?.getGameData();
  }

  if(QuesBS !== null && QuesBS.gameData !== undefined) {
    console.log('QuesBS: The script has been loaded.');

    clearInterval(QuesBSLoader);
    await QuesBS.initPathDetection();
    await QuesBS.updateQuestData();
    await QuesBS.updateCatacombData();
  } else {
    await QuesBS?.getGameData();
    console.log('QuesBS: Loading failed. Trying again...');
    numAttempts--;
    if(numAttempts <= 0) {
      clearInterval(QuesBSLoader); //Stop trying after a while
      console.log('QuesBS: Loading failed. Stopping...');
    }
  }
}