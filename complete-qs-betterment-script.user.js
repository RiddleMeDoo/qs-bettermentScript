// ==UserScript==
// @name         Queslar Betterment Script
// @namespace    https://www.queslar.com
// @version      1.6.6
// @description  A script that lets you know more info about quests and other QOL improvements
// @author       RiddleMeDoo
// @include      *queslar.com*
// @require      https://code.jquery.com/jquery-3.6.3.slim.min.js
// @resource     settingsMenu https://raw.githubusercontent.com/RiddleMeDoo/qs-bettermentScript/master/tomeSettingsMenu.html
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

    this.catacomb = {
      villageActionSpeed: 0,
      actionTimerSeconds: 30,
    }
    this.kdExploLevel = 0;
    this.playerId;
    this.gameData;

    //observer setup
    this.initObservers();
    this.currentPath = window.location.hash.split('/').splice(2).join();
  }

  loadDataFromStorage() {
    /**
     * Load data stored in the localStorage of the website. Each player stores their own settings.
     */
    // ! BANDAID migration, please remove non-id settings in storage after 2024-05-01
    this.villageSettings = JSON.parse(localStorage.getItem(`${this.playerId}:QuesBS_villageSettings`));
    if (!this.villageSettings && localStorage.getItem('QuesBS_villageSettings')) {
      // Attempt migration from old settings
      this.villageSettings = JSON.parse(localStorage.getItem('QuesBS_villageSettings'));
      localStorage.setItem(`${this.playerId}:QuesBS_villageSettings`, JSON.stringify(this.villageSettings));
    } else if(!this.villageSettings) {
      this.villageSettings = {
        strActions: 30000
      };
    }

    this.tomeSettings = JSON.parse(localStorage.getItem(`${this.playerId}:QuesBS_tomeSettings`));
    if (!this.tomeSettings && localStorage.getItem('QuesBS_tomeSettings')) {
      // Attempt migration from old settings
      this.tomeSettings = JSON.parse(localStorage.getItem('QuesBS_tomeSettings'));
      localStorage.setItem(`${this.playerId}:QuesBS_tomeSettings`, JSON.stringify(this.tomeSettings));
    } else if(!this.tomeSettings) {
      this.tomeSettings = {
        highlightReward: 99900,
        highlightMob: 99900,
        highlightCharacter: 99900,
        highlightCharacterWb: 99900,
        highlightElementalConv: 99900,
        highlightMultiMob: 1,
        highlightLifesteal: 1,
        highlightActionSpeed: 1,
        highlightMobSkip: 1,
        spaceLimitReward: 6,
        spaceLimitMob: 6,
        spaceLimitCharacter: 6,
        spaceLimitWb: 6,
        spaceLimitRare: 6,
        spaceLimitLegendary: 6,
        numGoodRolls: 1,
        ignoreNegativeRareLegendary: false,
        goldKillTomesEquippedAmount: 0,
      };
    }

    // ! More migration from v1.6.4, delete after 2024-05-01
    this.tomeSettings.highlightCharacterWb = this.tomeSettings.highlightCharacterWb ?? 99900;
    this.tomeSettings.highlightMultiMob = this.tomeSettings.highlightMultiMob ?? 1;
    this.tomeSettings.highlightLifesteal = this.tomeSettings.highlightLifesteal ?? 1;
    this.tomeSettings.highlightActionSpeed = this.tomeSettings.highlightActionSpeed ?? 1;
    this.tomeSettings.highlightMobSkip = this.tomeSettings.highlightMobSkip ?? 1;
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
      tomesAreEquipped: tomes.mobs > 0,
    }
  }

  async initPlayerData() {
    //Couldn't find an easier method to get quest completions than a POST request
    this.gameData.httpClient.post('/player/load/misc', {}).subscribe(
      val => {
        this.quest.questsCompleted = val.playerMiscData.quests_completed;
        this.playerId = val.playerMiscData.player_id;
        this.loadDataFromStorage();
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

    // Get catacomb data
    await this.updateCatacombData();

    // Get kd exploration level for wb drops
    await this.updateKdInfo();
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

  async updateKdInfo() {
    /** Only stores exploration information for wb drops */
    let kdService = this.gameData.playerKingdomService;
    // Wait for game to load data
    while(kdService?.kingdomData?.explorations === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    this.kdExploLevel = kdService.kingdomData.explorations.level;
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
    this.wbDropsObserver = new MutationObserver(mutationsList => {
      this.handleWbChestOpening(mutationsList[0]);
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


  async insertPlayerStatRatios(petDiv) {
    /* 
     * Insert player stat ratios into the pet div by copy pasting from one of the existing
     * boxes. 
     */
    // Copy existing box to match the css style
    const statBoxElem = petDiv.children[1].children[2].cloneNode(true);

    statBoxElem.firstChild.innerText = 'Player stat ratios';
    const statsBody = statBoxElem.children[1];

    const playerStatsElem = document.querySelector('app-inventory-menu > div > div:nth-child(3)');
    const statRatios = getStatRatios(playerStatsElem);
    // Insert the stat ratios
    for (let i = 0; i < statRatios.length; i++) {
      const row = statsBody.children[i].firstChild;
      row.children[1].innerText = `${playerStatsElem.children[i].children[1].innerText}`;
      const statRatioDiv = document.createElement('div');
      statRatioDiv.innerText = `(${statRatios[i]})`;
      row.appendChild(statRatioDiv);
    }

    // Insert elem to be under the pet farm column
    petDiv.children[2].appendChild(statBoxElem);
  }


  async handlePathChange(url) {
    /**
     * Detects which page the player navigated to when the url path
     * has changed, then activates the observer for the page.
     */
    const path = url.split('/').length == 2 ? url.split('/').slice(1) : url.split('/').slice(2);
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

    } else if (path[path.length - 1].toLowerCase() === 'tome_store' && path[0].toLowerCase() === 'catacombs') {
      await this.modifyTomeStorePage();

      let target = $('app-catacomb-tome-store > div > div > div.base-scrollbar > div');
      while(target.length < 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = $('app-catacomb-tome-store > div > div > div.base-scrollbar > div');
      }

      this.tomeObserver.observe(target[0], {
        childList: true, subtree: false, attributes: false
      });
      this.handleCatacombTomeStore({target: target[0]});

    } else if (path[path.length - 1].toLowerCase() === 'chests' && path[0].toLowerCase() === 'wb') {
      let target = $('app-game-world-boss-chests > div');
      while(target.length < 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = $('app-game-world-boss-chests > div');
      }
      this.wbDropsObserver.observe(target[0], {
        childList: true, subtree: false, attributes: false
      });
    } else if (path[path.length - 1].toLowerCase() === 'pets' && path[0].toLowerCase() === 'actions') {
      let target = $('app-actions-pets > .scrollbar > div > .d-flex');
      while(target.length < 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
        target = $('app-actions-pets > .scrollbar > div > .d-flex');
      }
      // Insert stat ratios on the pets page
      await this.insertPlayerStatRatios(target[0]);
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
        infoRow = await this.modifyQuestInfo(tableBody, false, false);

      } else if(tableBody.children.length > 0) { //Active quest
        //Update number of refreshes used, just in case
        await this.updateRefreshes();
        infoRow = await this.modifyQuestInfo(tableBody, false, true);

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
        await this.modifyQuestInfo(tableBody, true, false);
      } else { //Quest is active
        await this.modifyQuestInfo(tableBody, true, true);
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
      const parentElement = mainView.firstElementChild.firstChild.firstChild.firstChild;
      const mobText = parentElement.firstChild.firstChild.firstChild.children[1].innerText;
      const totalMobs = parseNumber(mobText.split(' ')[2]);
      const mobsKilled = parseNumber(mobText.split(' ')[0]);
      const secondsLeft = parseNumber(parentElement.children[1].innerText);

      // Create the end time ele to insert into
      const endTimeEle = document.getElementById('catacombEndTime') ?? document.createElement('div');
      endTimeEle.id = 'catacombEndTime';
      endTimeEle.setAttribute('class', 'h5');
      endTimeEle.innerText = `| End time: ${getCatacombEndTime(totalMobs - mobsKilled, this.catacomb.actionTimerSeconds, secondsLeft)}`;

      parentElement.appendChild(endTimeEle);

    } else { // Inactive view
      const mobOverviewEle = mainView.firstChild.children[1].firstChild.firstChild;
      const totalMobs = parseNumber(mobOverviewEle.firstChild.children[1].firstChild.children[11].children[1].innerText);
      const cataTierSelectionEle = mobOverviewEle.children[1];

      // Create the end time ele to insert into
      const endTimeEle = document.getElementById('catacombEndTime') ?? document.createElement('div');
      endTimeEle.id = 'catacombEndTime';
      endTimeEle.innerText = `End time (local): ${getCatacombEndTime(totalMobs, this.catacomb.actionTimerSeconds)}`;
      cataTierSelectionEle.appendChild(endTimeEle);

      // Create tooltips for gold/hr and emblems/hr
      const goldEle = mobOverviewEle.firstChild.children[1].firstChild.children[9].children[1];
      const boostedGoldPerKill = parseNumber(goldEle.innerText);
      const goldHr = boostedGoldPerKill / this.catacomb.actionTimerSeconds * 3600;
      goldEle.parentElement.setAttribute('title', `${goldHr.toLocaleString(undefined, {maximumFractionDigits:2})}/Hr`);

      const emblemsEle = mobOverviewEle.firstChild.children[1].firstChild.children[10].children[1];
      const emblemsHr = parseNumber(emblemsEle.innerText) / totalMobs / this.catacomb.actionTimerSeconds * 3600;
      emblemsEle.parentElement.setAttribute('title', `${emblemsHr.toLocaleString(undefined, {maximumFractionDigits:2})}/Hr`);

      // Highlight start button if tomes are equipped
      const goldPerKillEle = mutation.target.parentElement.parentElement?.previousSibling?.children?.[9]?.firstElementChild;
      if (!goldPerKillEle) return;  // Early return if element cannot be found, since mutations can come from anything
      const baseGoldPerKill = parseNumber(goldPerKillEle.innerText);
      const startCataButton = mobOverviewEle.nextSibling.firstChild;
      if (this.catacomb.tomesAreEquipped && baseGoldPerKill < this.tomeSettings.goldKillTomesEquippedAmount) {
        startCataButton.style.boxShadow = '0px 0px 12px 7px red';
        startCataButton.style.color = 'red';
      } else {
        startCataButton.style.boxShadow = 'none';
        startCataButton.style.color = '';
      }
    }
  }

  async handleCatacombTomeStore(mutation) {
    /**
     * Add highlights around tomes with good boosts and obscures bad tomes
     * Credit to Ender for code collaboration and fading out tomes
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
    // Get store element and tome store data
    const tomeElements = $('app-catacomb-tome-store > div > div > div.base-scrollbar > div > div');
    let tomes = this.gameData.playerCatacombService?.tomeStore;
    while (this.gameData.playerCatacombService === undefined || tomes === undefined) {
      await new Promise(resolve => setTimeout(resolve, 200))
      tomes = this.gameData.playerCatacombService?.tomeStore;
    }
    // Put an id on the first tome of the store to mark it as "processed"
    tomeElements[0].id = 'highlight';

    // For each tome (loop by index), check if tome has good modifiers.
    for (let i = 0; i < tomes.length; i++) {
      const tomeMods = tomes[i];
      const tomeElement = tomeElements[i].firstChild;

      // Requirements are checked here since they're very long
      const hasNegativeRareLegendaryRolls = tomeMods.lifesteal < 0 || tomeMods.multi_mob < 0 
                                            || tomeMods.speed < 0 || tomeMods.skip < 0;
      const meetsRareRequirements = (
        (tomeMods.lifesteal > 0 || tomeMods.multi_mob > 0) && tomeMods.space_requirement <= this.tomeSettings.spaceLimitRare
      );
      const meetsLegendaryRequirements = (
        (tomeMods.speed > 0 || tomeMods.skip > 0) && tomeMods.space_requirement <= this.tomeSettings.spaceLimitLegendary
      );
      
      const meetsWbTomeRequirements = 
        tomeMods.space_requirement <= this.tomeSettings.spaceLimitWb 
        && tomeMods.elemental_conversion >= 0
        && tomeMods.character_multiplier >= 0
        && (tomeMods.elemental_conversion >= this.tomeSettings.highlightElementalConv
        || tomeMods.character_multiplier >= this.tomeSettings.highlightCharacterWb);

      const meetsRewardMultiRequirements = tomeMods.reward_multiplier >= this.tomeSettings.highlightReward 
        && tomeMods.space_requirement <= this.tomeSettings.spaceLimitReward;
      const meetsMobDebuffRequirements = tomeMods.mob_multiplier >= this.tomeSettings.highlightMob 
        && tomeMods.space_requirement <= this.tomeSettings.spaceLimitMob
        && tomeMods.reward_multiplier >= 0;
      const meetsCharacterMultiRequirements = tomeMods.character_multiplier >= this.tomeSettings.highlightCharacter 
        && tomeMods.space_requirement <= this.tomeSettings.spaceLimitCharacter
        && tomeMods.reward_multiplier >= 0;

      let sumGoodRolls = 0; // Count how many requirements were met
      let shouldFadeTome = true;  // Flag that determines whether tome should be faded

      // Highlight world boss tomes
      if (meetsWbTomeRequirements) {
        let sumRolls = 0;

        if (tomeMods.elemental_conversion >= this.tomeSettings.highlightElementalConv) {
          const isDoubleElemental = tomeMods.elemental_conversion >= this.tomeSettings.highlightElementalConv * 2;
          sumRolls += isDoubleElemental ? 2 : 1;
          tomeElement.children[11].style.border = `${isDoubleElemental ? 'thick' : '1px'} solid`;
          tomeElement.children[11].style.borderColor = 'forestgreen';
        } 

        if (tomeMods.character_multiplier >= this.tomeSettings.highlightCharacterWb) {
          const isDoubleCharacter = tomeMods.character_multiplier >= this.tomeSettings.highlightCharacterWb * 2;
          sumRolls += isDoubleCharacter ? 2 : 1;
          tomeElement.children[5].style.border = `${isDoubleCharacter ? 'thick' : '1px'} solid`;
          tomeElement.children[5].style.borderColor = 'forestgreen';
        }

        if (sumRolls > 1) {
          shouldFadeTome = false;
        }
      }

      // Highlight other modifiers if they meet the requirements
      if (!hasNegativeRareLegendaryRolls || this.tomeSettings.ignoreNegativeRareLegendary) { 
        if (meetsRareRequirements) {
          sumGoodRolls += tomeMods.lifesteal > 0 ? Math.floor(tomeMods.lifesteal / this.tomeSettings.highlightLifesteal) : 0;
          sumGoodRolls += tomeMods.multi_mob > 0 ? Math.floor(tomeMods.multi_mob / this.tomeSettings.highlightMultiMob) : 0;
        }
        if (meetsLegendaryRequirements) {
          sumGoodRolls += tomeMods.speed > 0 ? Math.floor(tomeMods.speed / this.tomeSettings.highlightActionSpeed) : 0;
          sumGoodRolls += tomeMods.skip > 0 ? Math.floor(tomeMods.skip / this.tomeSettings.highlightMobSkip) : 0;
        }

        if (meetsRewardMultiRequirements) {
          const isDouble = tomeMods.reward_multiplier >= this.tomeSettings.highlightReward * 2;
          tomeElement.children[3].style.border = `${isDouble ? 'thick' : '2px'} solid`;
          tomeElement.children[3].style.borderColor = tomeElement.children[3].firstChild.style.color ?? 'gold';
          
          sumGoodRolls += Math.floor(tomeMods.reward_multiplier / this.tomeSettings.highlightReward);
        }
        if (meetsMobDebuffRequirements) {
          const isDouble = tomeMods.mob_multiplier >= this.tomeSettings.highlightMob * 2;
          tomeElement.children[4].style.border = `${isDouble ? 'thick' : '2px'} solid`;
          tomeElement.children[4].style.borderColor = tomeElement.children[4].firstChild.style.color ?? 'white';
          
          sumGoodRolls += Math.floor(tomeMods.mob_multiplier / this.tomeSettings.highlightMob);
        }
        if (meetsCharacterMultiRequirements) {
          const isDouble = tomeMods.character_multiplier >= this.tomeSettings.highlightCharacter * 2;
          tomeElement.children[5].style.border = `${isDouble ? 'thick' : '2px'} solid`;
          tomeElement.children[5].style.borderColor = tomeElement.children[5].firstChild.style.color ?? 'white';

          sumGoodRolls += Math.floor(tomeMods.character_multiplier / this.tomeSettings.highlightCharacter);
        }
      }

      if (sumGoodRolls >= this.tomeSettings.numGoodRolls) {
        shouldFadeTome = false;
      } 

      // Fade out tomes that didn't meet requirements
      if (shouldFadeTome) {
        tomeElement.style.color = "rgba(255, 255, 255, 0.4)";
        [...tomeElement.children].forEach((child) => {
           child.style.opacity = "0.4";
        });
      }
    }
  }

  async handleWbChestOpening(mutation) {
    /**
     * Highlight drops that are desirable
     * - Gems over the kd level
     * - Descriptions with max depth 26+
     * - Equipment with depth 23+
    **/
    // Check if first time opening chests on page
    if (mutation?.addedNodes?.[0]?.innerText && mutation.addedNodes[0].innerText.startsWith('After')) {
      // Change observer to listen to subsequent chest openings
      let target = document.querySelector('app-game-world-boss-chest-drops');
      this.wbDropsObserver.disconnect();
      this.wbDropsObserver.observe(target, {
        childList: true, subtree: false, attributes: false
      });
    }


    // Get list of drops
    const dropsList = document.querySelector('app-game-world-boss-chest-drops').children;
    for (const drop of dropsList) {
      const text = drop.innerText.split(' ');
      const dropType = text[text.length - 1].toLowerCase();
      if (dropType === 'gem' || dropType === 'description' || dropType === 'item') {
        // Additional filters
        if (dropType === 'gem' && parseNumber(text[1]) < this.kdExploLevel) {
          // Gem has to be higher level than kd exploration level
          continue;
        } else if (dropType === 'description' && parseNumber(text[1].split('-')[1]) <= 25) {
          // Description has to be max depth 26+
          continue;
        } else if (dropType === 'item' && parseNumber(text[1]) < 22) {
          // Fighter item needs to be at a good potential depth
          continue;
        }
        // Highlight the element
        drop.style.backgroundColor = 'darkblue';
      }
    }
  }

  stopObserver(pathname) {
    const stop = {
      'actions,quests': () => this.personalQuestObserver.disconnect(),
      'village,quests': () => this.villageQuestObserver.disconnect(),
      'catacombs,catacomb': () => this.catacombObserver.disconnect(),
      'catacombs,tome_store': () => this.tomeObserver.disconnect(),
      'wb,chests': () => this.wbDropsObserver.disconnect(),
      'portal': () => this.initPlayerData(),
    }
    if(stop[pathname]) {
      stop[pathname]();
    }
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

  async modifyQuestInfo(tableBody, isVillage, isActiveQuest) {
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
        const actionsDone = parseNumber(objectiveElemText[0]);
        const objective = parseNumber(objectiveElemText[2]);
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
        const goldCollected = parseNumber(objectiveElemText[0]);
        const objective = parseNumber(objectiveElemText[2]);
        const currentMonster = this.gameData.playerActionService.selectedMonster;
        const baseGoldPerAction = 8 + 2 * currentMonster;
        const actionsNeeded = Math.ceil((objective - goldCollected) / baseGoldPerAction);
        // Insert end time
        timeElem = this.getTimeElem(actionsNeeded, row.firstChild.className, isVillage);
        row.appendChild(timeElem);

        //Add ratio
        const reward = row.children[2].innerText.split(' ')[0].replace(/,/g, '');
        const ratio = Math.round(parseNumber(reward) / actionsNeeded).toLocaleString();
        row.children[2].innerText = `${row.children[2].innerText} (${ratio} exp/action)`;

        // Replace exp requirement with action requirement
        const actionsDone = Math.floor(goldCollected / baseGoldPerAction).toLocaleString();
        const actionsLeft = Math.ceil(objective / baseGoldPerAction).toLocaleString();
        row.children[1].innerText = `${actionsDone} / ${actionsLeft} actions (does not update)`;

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
          if(reward === 'strength' && parseNumber(objectiveText[0]) <= this.villageSettings.strActions) {
            row.children[2].style.border = 'inset';
          }
          //Insert end time
          const objective = parseNumber(objectiveText[0]);
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
          actionsNeeded = parseNumber(availableQuests[i].objective.split(' ')[0]);

        } else if(availableQuests[i].type === 'treasure') {
          actionsNeeded = parseNumber(availableQuests[i].objective.split(' ')[0]);
          //Insert a gold ratio
          const reward = parseNumber(availableQuests[i].reward.split(' ')[0]);
          const ratio = Math.round(reward / actionsNeeded * 600).toLocaleString();
          row.children[1].innerText = `${row.children[1].innerText} (${ratio} gold/hr)`;

        } else if(availableQuests[i].type === 'slow') {
          //Convert 7 second actions to 6 second actions
          actionsNeeded = parseNumber(availableQuests[i].objective.split(' ')[0]) * 7 / 6;

        } else if(availableQuests[i].type === 'friend') { //Base gold objective
          const goldObjective = parseNumber(availableQuests[i].objective.split(' ')[0]);
          const currentMonster = this.gameData.playerActionService.selectedMonster;
          actionsNeeded = Math.ceil(goldObjective / (8 + 2 * currentMonster));
          //Insert a exp ratio
          const reward = parseNumber(row.children[1].innerText.split(' ')[0]);
          const ratio = Math.round(reward / actionsNeeded).toLocaleString();
          row.children[1].innerText = `${row.children[1].innerText} (${ratio} exp/action)`;
          // Convert gold requirement to action requirement
          row.children[0].innerText = `${actionsNeeded.toLocaleString()} actions`;
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
      const newActions = parseNumber(document.getElementById('actionsLimitSetting').firstChild.value);
      //Data validation
      if(isNaN(newActions)) {
        this.gameData.snackbarService.openSnackbar('Error: Value should be a number'); //feedback popup
      } else {
        this.villageSettings.strActions = newActions;
        localStorage.setItem(`${this.playerId}:QuesBS_villageSettings`, JSON.stringify(this.villageSettings));
        this.gameData.snackbarService.openSnackbar('Settings saved successfully'); //feedback popup
      }
    }
    settingsOverview.appendChild(questSettings);
  }
  
  async modifyTomeStorePage() {
    /**
     * Inserts a custom popup menu for tome settings
     */  
    //Get store page contents
    let tomeStoreOverview = document.querySelector('app-catacomb-tome-store');
    while(!tomeStoreOverview) {
      await new Promise(resolve => setTimeout(resolve, 50));
      tomeStoreOverview = document.querySelector('app-catacomb-tome-store');
    }

    // Create settings menu
    const settings = document.createElement('div');
    settings.id = 'highlightTomeSettings';
    settings.style.margin = '1rem';
    settings.style.position = 'relative';
    settings.innerHTML = GM_getResourceText('settingsMenu');
    const openTomeSettingsbutton = document.createElement('button');
    openTomeSettingsbutton.id = 'openTomeSettingsButton';
    openTomeSettingsbutton.className = 'mat-focus-indicator mat-raised-button mat-button-base';
    openTomeSettingsbutton.innerText = 'QuesBS Tome Settings';
    settings.insertBefore(openTomeSettingsbutton, settings.childNodes[0]);
    const topStoreBar = tomeStoreOverview.firstChild.firstChild;
    topStoreBar.insertBefore(settings, topStoreBar.firstChild);

    // Fill in input values
    const settingsContainer = settings.childNodes[1];
    settingsContainer.querySelector('#rewardHighlightSetting').value = (this.tomeSettings.highlightReward / 100).toFixed(2);
    settingsContainer.querySelector('#mobHighlightSetting').value = (this.tomeSettings.highlightMob / 100).toFixed(2);
    settingsContainer.querySelector('#characterHighlightSetting').value = (this.tomeSettings.highlightCharacter / 100).toFixed(2);
    settingsContainer.querySelector('#characterWbHighlightSetting').value = (this.tomeSettings.highlightCharacterWb / 100).toFixed(2);
    settingsContainer.querySelector('#elementalConvHighlightSetting').value = (this.tomeSettings.highlightElementalConv / 100).toFixed(2);
    settingsContainer.querySelector('#multiMobHighlightSetting').value = (this.tomeSettings.highlightMultiMob / 100).toFixed(2);
    settingsContainer.querySelector('#lifestealHighlightSetting').value = (this.tomeSettings.highlightLifesteal / 100).toFixed(2);
    settingsContainer.querySelector('#actionSpeedHighlightSetting').value = (this.tomeSettings.highlightActionSpeed / 100).toFixed(2);
    settingsContainer.querySelector('#mobSkipHighlightSetting').value = (this.tomeSettings.highlightMobSkip / 100).toFixed(2);
    settingsContainer.querySelector('#rewardSpaceSetting').value = this.tomeSettings.spaceLimitReward ?? 6;
    settingsContainer.querySelector('#mobSpaceSetting').value = this.tomeSettings.spaceLimitMob ?? 6;
    settingsContainer.querySelector('#characterSpaceSetting').value = this.tomeSettings.spaceLimitCharacter ?? 6;
    settingsContainer.querySelector('#wbSpaceSetting').value = this.tomeSettings.spaceLimitWb ?? 9;
    settingsContainer.querySelector('#rareSpaceSetting').value = this.tomeSettings.spaceLimitRare ?? 9;
    settingsContainer.querySelector('#legendarySpaceSetting').value = this.tomeSettings.spaceLimitLegendary ?? 9;
    settingsContainer.querySelector('#numGoodRolls').value = this.tomeSettings.numGoodRolls ?? 1;
    settingsContainer.querySelector('#ignoreNegativeRareLegendaryRolls').checked = this.tomeSettings.ignoreNegativeRareLegendary ?? false;
    settingsContainer.querySelector('#goldPerKillForTomesEquipped').value = this.tomeSettings.goldKillTomesEquippedAmount ?? 0;

    // Set up buttons
    openTomeSettingsbutton.onclick = () => {  // Toggle open and close menu
      const container = document.querySelector('#tomeSettingsContainer');
      if (container.style.display === 'none') {
        container.style.display = 'inline-block';
      } else {
        container.style.display = 'none';
      }
    };
    document.querySelector('#tomeSettingsSaveButton').onclick = () => {
      // Get all of the values
      const container = document.querySelector('#tomeSettingsContainer');
      const tomeSettings = {
        highlightReward: container.querySelector('#rewardHighlightSetting').valueAsNumber * 100,
        highlightMob: container.querySelector('#mobHighlightSetting').valueAsNumber * 100,
        highlightCharacter: container.querySelector('#characterHighlightSetting').valueAsNumber * 100,
        highlightCharacterWb: container.querySelector('#characterWbHighlightSetting').valueAsNumber * 100,
        highlightElementalConv: container.querySelector('#elementalConvHighlightSetting').valueAsNumber * 100,
        highlightMultiMob: container.querySelector('#multiMobHighlightSetting').valueAsNumber * 100,
        highlightLifesteal: container.querySelector('#lifestealHighlightSetting').valueAsNumber * 100,
        highlightActionSpeed: container.querySelector('#actionSpeedHighlightSetting').valueAsNumber * 100,
        highlightMobSkip: container.querySelector('#mobSkipHighlightSetting').valueAsNumber * 100,
        spaceLimitReward: container.querySelector('#rewardSpaceSetting').valueAsNumber,
        spaceLimitMob: container.querySelector('#mobSpaceSetting').valueAsNumber,
        spaceLimitCharacter: container.querySelector('#characterSpaceSetting').valueAsNumber,
        spaceLimitWb: container.querySelector('#wbSpaceSetting').valueAsNumber,
        spaceLimitRare: container.querySelector('#rareSpaceSetting').valueAsNumber,
        spaceLimitLegendary: container.querySelector('#legendarySpaceSetting').valueAsNumber,
        numGoodRolls: container.querySelector('#numGoodRolls').valueAsNumber,
        ignoreNegativeRareLegendary: container.querySelector('#ignoreNegativeRareLegendaryRolls').checked,
        goldKillTomesEquippedAmount: container.querySelector('#goldPerKillForTomesEquipped').valueAsNumber,
      };
      // Sanitize inputs
      for (const [key, value] of Object.entries(tomeSettings)) {
        this.tomeSettings[key] = isNaN(value) ? this.tomeSettings[key] : value;
      }
      localStorage.setItem(`${this.playerId}:QuesBS_tomeSettings`, JSON.stringify(this.tomeSettings));
      // Refresh highlighting
      const target = $('app-catacomb-tome-store > .scrollbar > div > div > .d-flex.flex-wrap.gap-1');
      this.handleCatacombTomeStore({target: target[0]});
    }
  }
}

// ----------------------------------------------------------------------------
// Helper functions

function getCatacombEndTime(numMobs, actionTimerSeconds, extraSeconds=0) {
  const current = new Date();
  const options = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  };
  const finishTime = new Date(current.getTime() + (numMobs * actionTimerSeconds + extraSeconds) * 1000)
                              .toLocaleString('en-US', options);
  return finishTime;
}

function getStatRatios(statBlockElem) {
  /* Given an element statBlockElem containing rows of the 4 stats displayed at  
  the top of the page, return the ratios between the stats
  */
  const stats = [];

  for (let i = 0; i < statBlockElem.children.length; i++) {
    const row = statBlockElem.children[i];
    stats.push(parseNumber(row.children[1].firstChild.innerText));
  }

  const minStat = Math.min(...stats);
  return [
    (stats[0] / minStat).toFixed(2), 
    (stats[1] / minStat).toFixed(2),
    (stats[2] / minStat).toFixed(2),
    (stats[3] / minStat).toFixed(2),
  ];
}

function parseNumber(num) {
  /**
   * Given a num (string), detect the type of number formatting it uses and then
   * convert it to the type Number. 
  **/
  // First strip any commas
  const resultNumStr = num.replace(/,/g, '');
  if (!isNaN(Number(resultNumStr))) {  // This can also convert exponential notation
    return Number(resultNumStr);
  }

  // Check if string has suffix
  const suffixes = ["k", "m", "b", "t", "qa", "qi", "sx", "sp"];
  const suffixMatch = resultNumStr.match(/[a-z]+\b/g);
  if (suffixMatch) {
    const suffix = suffixMatch[0];
    const shortenedNum = parseFloat(resultNumStr.match(/[0-9.]+/g)[0]);

    const multiplier = 1000 ** (suffixes.findIndex(e => e === suffix) + 1)
    if (multiplier < 1000) {
      console.log('QuesBS: ERROR, number\'s suffix not found in existing list');
      return 0;
    } else {
      return shortenedNum * multiplier;
    }
  }
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
    await QuesBS.initPlayerData();
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