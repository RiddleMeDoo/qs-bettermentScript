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