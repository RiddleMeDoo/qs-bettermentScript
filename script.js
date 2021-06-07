// ==UserScript==
// @name         Queslar Testing Grounds
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  This is an attempt to do scripting stuff with Queslar
// @author       RiddleMeDoo
// @match        *test.queslar.com*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

class QTGScript {
  constructor() {
    // Get quest data
    this.quest = {
      numCompleted: 0,
      numRefreshes: 0,
      refreshesUsed: 0,
      villageBold: 0,
      baseStat: 15,
      minActions: 360,
      maxActions: 580,
    };
    
    //observer stuff
    this.initObservers();
    this.currentPath = window.location.hash.split("/").splice(2).join();
  }

  get gameData() { //ULTIMATE POWER
    //Dynamically get an update of the game's state
    let rootElement = getAllAngularRootElements()[0].children[1]["__ngContext__"][30];
    return rootElement.playerGeneralService;
  }

  async updateQuestData() {
    //Couldn't find an easier method than doing a POST request
    this.gameData.httpClient.post('/player/load/misc', {}).subscribe(
      val => {this.quest.questsCompleted = val.playerMiscData.quests_completed},
      response => console.log('QTG: POST request failure', response)
    );
    let questService = this.gameData.playerQuestService;
    // //Great power comes with a cost
    // //Wait for service to load
    // while(!playerGeneralService.playerQuestService || !questService.refreshesUsed && !questService.refreshesBought) {
    //   await new Promise(resolve => setTimeout(resolve, 1000));
    // }

    this.quest.numRefreshes = questService.refreshesBought + 5;
    this.quest.refreshesUsed = questService.refreshesUsed;
    if(this.gameData.playerVillageService.isInVillage) {
      this.quest.villageBold = this.gameData.playerVillageService.strengths.bold.amount;
    }
    //Can't be bothered to calculate it accurately using all 4 stats
    this.quest.baseStat = Math.min(15, this.gameData.playerStatsService.strength * 0.0025);
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

  async handlePathChange() {
    const path = window.location.hash.split("/").slice(2);
    if(path.join() !== this.currentPath) {
      this.stopObserver(this.currentPath);
    }
    this.currentPath = path.join();
    //Activate observer if on a specific page
    if(path[path.length - 1] === 'quests' && path[0] === 'actions') {
      const target = document.querySelector('app-actions');
      this.personalQuestObserver.observe(target, {
        childList: true, subtree: true, attributes: false,
      });
      await this.updateQuestData();
    }
  }

  handlePersonalQuest(mutation) {
    //Filter out any unneeded mutations
    if(mutation.addedNodes.length < 1 || 
      mutation.addedNodes[0].localName === 'mat-tooltip-component' || 
      mutation.addedNodes[0].nodeName === '#text') {
      return;
    }
    let questTable = mutation.target.tagName === 'TBODY' ? mutation.target : mutation.target.querySelector('tbody');
    
    if(questTable) {
      let rowIndex = 0;
      let infoRow = null;
      let objective = 0;
      
      //There are two states: active quest and no quest
      if(questTable.children.length > 2) {//No quest
        rowIndex = 2;
        infoRow = this.getRatioElem();
        const objectiveElem = questTable.children[2].children[1];
        objective = parseInt(objectiveElem.innerText.split(" ")[0].replace(/,/g, ""));
      } else if(questTable.children.length > 0) { //Active quest
        //Update number of refreshes used, just in case
        this.quest.refreshesUsed = this.gameData.playerQuestService.refreshesUsed;

        const objectiveElem = questTable.children[0].children[1];
        const actionsDone = parseInt(objectiveElem.innerText.split(" ")[0]);
        objective = parseInt(objectiveElem.innerText.split(" ")[2]);
        infoRow = this.getQuestInfoElem(objective - actionsDone);
        
        //Add information below table
        if(!document.getElementById('questExplanation')) {
          const questDiv = questTable.parentElement.parentElement;
          const infoDiv = document.createTextNode('Finish time is in local time. The second time includes 1440 party actions.');
          infoDiv.id = 'questExplanation';
          questDiv.appendChild(infoDiv);
        }
      } else {
        return;
      }
      const statRewardElem = questTable.children[rowIndex].children[2];
      
      //Might as well parse these instead of using the heavy questService
      const statReward = parseInt(statRewardElem.innerText.split(" ")[0].replace(/,/g, ""));
      statRewardElem.innerText = `${statRewardElem.innerText} (${(objective/statReward).toFixed(3)})`;
      
      //Add an extra row for extra quest info if there isn't one already
      if(!document.getElementById('questInfoRow')) questTable.appendChild(infoRow); 
    }
  }

  handleVillageQuest(mutation) {
    return; //Uninplemented
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
      max: Math.round((this.quests.questsCompleted/300+this.quests.baseStat+22.75)*(1+this.quests.villageBold*2/100)*1.09),
      min: Math.round((this.quests.questsCompleted/300+this.quests.baseStat+8.5)*(1+this.quests.villageBold*2/100)*1.09),
    }
  }

  getQuestInfoElem(actionsNeeded) {
    let row = document.createElement('tr');

    const date = new Date();
    const finishTime = new Date(date.getTime() + actionsNeeded * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
    const finishPartyTime = new Date(date.getTime() + (actionsNeeded + 1440) * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
    const info = ['',`${this.refreshesUsed}/${this.quest.numRefreshes} refreshes used`, '',
      `Finishes at ${finishTime} - ${finishPartyTime}`];
    let htmlInfo = '';
    for (let text of info) {
      htmlInfo += `<td>${text}</td>`
    }
    row.innerHTML = htmlInfo;
    row.id = 'questInfoRow';
    return row;
  }

  getRatioElem() {
    let row = document.createElement('tr');
    const stat = this.getStatReward();
    const avg = (this.quest.minActions/stat.max + this.quest.maxActions/stat.min) / 2;
    const info = ['',
      `Max Ratio: ${(this.quest.minActions/stat.max).toFixed(3)}`,
      `Avg ratio: ${(avg).toFixed(3)}`, 
      `Min ratio: ${(this.quest.maxActions/stat.min).toFixed(3)}`
    ];
    let htmlInfo = '';
    for (let text of info) {
      htmlInfo += `<td>${text}</td>`
    }
    row.innerHTML = htmlInfo;
    row.id = 'questInfoRow';
    return row;
  }
}


// class Quest {
//   constructor() {
//     this.questsCompleted = 0;
//     this.numRefreshes = 0;
//     this.refreshesUsed = 0;
//     this.villageBold = 0;
//     this.baseStat = 15;
//     this.minActions = 360;
//     this.maxActions = 580;
//   }

//   async updateData(playerGeneralService) {
//     //Couldn't find an easier method than doing a POST request
//     playerGeneralService.httpClient.post('/player/load/misc', {}).subscribe(
//       val => {this.questsCompleted = val.playerMiscData.quests_completed},
//       response => console.log('QTG: POST request failure', response)
//     );
//     let questService = playerGeneralService.playerQuestService;
//     //Great power comes with a cost
//     //Wait for service to load
//     while(!playerGeneralService.playerQuestService || !questService.refreshesUsed && !questService.refreshesBought) {
//       await new Promise(resolve => setTimeout(resolve, 1000));
//     }

//     this.numRefreshes = questService.refreshesBought + 5;
//     this.refreshesUsed = questService.refreshesUsed;
//     if(playerGeneralService.playerVillageService.isInVillage) {
//       this.villageBold = playerGeneralService.playerVillageService.strengths.bold.amount;
//     }
//     //Can't be bothered to calculate it accurately using all 4 stats
//     this.baseStat = Math.min(15, playerGeneralService.playerStatsService.strength * 0.0025);
//   }

//   setRefreshesUsed(numRefreshes) {
//     this.refreshesUsed = numRefreshes;
//   }

//   getStatReward() {
//     return {
//       max: Math.round((this.questsCompleted/300+this.baseStat+22.75)*(1+this.villageBold*2/100)*1.09),
//       min: Math.round((this.questsCompleted/300+this.baseStat+8.5)*(1+this.villageBold*2/100)*1.09),
//     }
//   }

//   getQuestInfoElem(actionsNeeded) {
//     let row = document.createElement('tr');

//     const date = new Date();
//     const finishTime = new Date(date.getTime() + actionsNeeded * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
//     const finishPartyTime = new Date(date.getTime() + (actionsNeeded + 1440) * 6000).toLocaleTimeString('en-GB').match(/\d\d:\d\d/)[0];
//     const info = ['',`${this.refreshesUsed}/${this.numRefreshes} refreshes used`, '',
//       `Finishes at ${finishTime} - ${finishPartyTime}`];
//     let htmlInfo = '';
//     for (let text of info) {
//       htmlInfo += `<td>${text}</td>`
//     }
//     row.innerHTML = htmlInfo;
//     row.id = 'questInfoRow';
//     return row;
//   }

//   getRatioElem() {
//     let row = document.createElement('tr');
//     const stat = this.getStatReward();
//     const avg = (this.minActions/stat.max + this.maxActions/stat.min) / 2;
//     const info = ['',
//       `Max Ratio: ${(this.minActions/stat.max).toFixed(3)}`,
//       `Avg ratio: ${(avg).toFixed(3)}`, 
//       `Min ratio: ${(this.maxActions/stat.min).toFixed(3)}`
//     ];
//     let htmlInfo = '';
//     for (let text of info) {
//       htmlInfo += `<td>${text}</td>`
//     }
//     row.innerHTML = htmlInfo;
//     row.id = 'questInfoRow';
//     return row;
//   }
// }


// This is where the script starts
var QTG = null;
console.log('QTG: Init load');
let QTGLoader = null;
let numAttempts = 30;

window.addEventListener('load', () => { //Load the page first before setting up the script
  QTGLoader = setInterval(setupScript, 3000);
});

async function setupScript() {
  if(document.getElementById('profile-next-level') && QTG === null) {
    QTG = new QTGScript();
    console.log('QTG: The script has been loaded.');

    window.addEventListener('locationchange', function(){
      QTG.handlePathChange();
    })
    clearInterval(QTGLoader);
  } else {
    console.log('QTG: Loading failed. Trying again...');
    numAttempts--;
    if(numAttempts <= 0) clearInterval(QTGLoader); //Stop trying after a while
  }
}


//Code needed to detect hash (path) change in url
history.pushState = ( f => function pushState(){
  var ret = f.apply(this, arguments);
  window.dispatchEvent(new Event('pushstate'));
  window.dispatchEvent(new Event('locationchange'));
  return ret;
})(history.pushState);

history.replaceState = ( f => function replaceState(){
  var ret = f.apply(this, arguments);
  window.dispatchEvent(new Event('replacestate'));
  window.dispatchEvent(new Event('locationchange'));
  return ret;
})(history.replaceState);

window.addEventListener('popstate',()=>{
  window.dispatchEvent(new Event('locationchange'))
});
