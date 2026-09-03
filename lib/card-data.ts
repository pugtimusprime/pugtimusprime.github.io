export type Faction = "Autobot" | "Decepticon" | "Predacon" | "Maximal";
export type Role = "Commander" | "Scout" | "Trooper" | "Tactician";
export type Unit = { id:string; name:string; faction:Faction; role:Role; max:number; hp:number; dmg:number; ability:string; image:string; abilityUses:number; canAttack:boolean; shield?:number; poison?:number; diveBonus?:boolean; };
export type Slot = Unit | null;
export type BattleInfo = { rarity:"Common"|"Rare"; effect:string; image:string };

const rows: Record<Faction, [string,string,Role,number,number,string,number][]> = {
  Autobot:[
    ["optimus","Optimus Prime","Commander",100,15,"Move an Autobot about to die to another spot to avoid death. 1 use.",1],
    ["grimlock","Grimlock","Commander",80,20,"After defeating an enemy Commander, Grimlock may use all 3 attacks next turn. 1 use.",1],
    ["bee","Bumblebee","Scout",40,5,"While deployed with an Autobot Commander, Bumblebee gives himself and that Commander +5 Damage.",0],
    ["wheelie","Wheelie","Scout",50,10,"Cannot be revealed by abilities or Battle Cards.",0],
    ["eject","Eject","Scout",40,5,"Guess an enemy space. If a Scout is there, permanently swap Eject with it. 1 use.",1],
    ["sun","Sunstreaker","Trooper",80,20,"If Sideswipe is deployed, Sunstreaker may attack twice. 2 uses.",2],
    ["side","Sideswipe","Trooper",60,25,"If Sunstreaker dies while both are deployed, Sideswipe returns to full Health. 1 use.",1],
    ["ratchet","Ratchet","Tactician",70,10,"When damaged, every character sharing Ratchet's horizontal row heals 15. 1 use.",1],
    ["wheeljack","Wheeljack","Tactician",50,15,"All deployed Scouts gain +5 Damage on their next attack. 1 use.",1],
    ["elita","Elita-1","Commander",100,15,"A full Autobot team disables enemy Commander abilities until 2 Autobots die.",0],
    ["brawn","Brawn","Scout",50,10,"If killed by a Decepticon, the opponent scraps 2 Battle Cards. 1 use.",1],
  ],
  Decepticon:[
    ["megatron","Megatron","Commander",80,20,"Every Autobot Megatron defeats lets him heal any Decepticon by 10.",0],
    ["overlord","Overlord","Commander",100,15,"Scrap 4 Battle Cards to permanently change Overlord's Damage to 20.",1],
    ["soundwave","Soundwave","Tactician",70,10,"If Megatron is deployed, draw 3 Battle Cards. 1 use.",1],
    ["bombshell","Bombshell","Scout",40,5,"Choose an enemy space. A character there damages itself for its own Damage. 1 use.",1],
    ["shrapnel","Shrapnel","Scout",50,10,"If Kickback dies while Shrapnel is deployed, Kickback attacks once more. 1 use.",1],
    ["starscream","Starscream","Trooper",80,20,"After death, sacrifice any character to restore Starscream to Backup with 60 Health.",1],
    ["thunder","Thundercracker","Trooper",80,20,"Roll Out heals Thundercracker for 20 instead. 2 uses.",2],
    ["dreadwing","Dreadwing","Trooper",60,25,"Deny any Battle Card the opponent uses. 1 use.",1],
    ["shockwave","Shockwave","Tactician",50,15,"Launch one powerful 30-Damage attack. 1 use.",1],
    ["skywarp","Skywarp","Trooper",60,25,"When repositioning, freely move Skywarp to any spot. 2 uses.",2],
    ["fangry","Fangry","Scout",40,5,"Upon death, secretly remain with 20 Health but lose the ability to attack.",1],
    ["kickback","Kickback","Scout",50,10,"If attacked by a Trooper, heal any deployed character by 10. 1 use.",1],
  ],
  Predacon:[
    ["razor","Razorclaw","Commander",80,20,"Combine with one Backup: gain its Health and scrap it. 1 use.",1],
    ["pmega","Megatron (P)","Commander",100,15,"Force the opponent to reorder their deployed cards before you attack. 2 uses.",2],
    ["dive","Divebomb","Scout",40,5,"While deployed, all other Predacons gain 10 Health.",0],
    ["scorp","Scorponok","Scout",50,10,"Take a lethal hit for a Commander. 2 uses.",2],
    ["wasp","Waspinator","Scout",50,10,"The opponent reveals the positions of all 3 Scouts. 1 use.",1],
    ["rampage","Rampage","Trooper",80,20,"If Razorclaw combines with Rampage, draw 2 Battle Cards.",0],
    ["rampagebw","Rampage (P)","Trooper",60,25,"While in Backup, heal 15 every 3 turns.",0],
    ["head","Headstrong","Tactician",50,15,"At full Health, choose an enemy space. If occupied, both cards die. 1 use.",1],
    ["arachnia","Black Arachnia","Tactician",70,10,"Choose an enemy row; everyone there takes 5 poison damage for 3 rounds. 1 use.",1],
    ["terror","Terrorsaur","Tactician",70,10,"Start with a shield that completely blocks the first attack. 1 use.",1],
  ],
  Maximal:[["primal","Optimus Primal","Commander",100,15,"If your other Commander dies, Optimus Primal permanently gains +10 Health and +10 Damage.",0]],
};

const imageNames:Record<string,string>={bee:"bumblebee",sun:"sunstreaker",side:"sideswipe",pmega:"megatron-p",rampagebw:"rampage-p",head:"headstrong",arachnia:"black-arachnia",razor:"razorclaw",scorp:"scorponok",wasp:"waspinator",dive:"divebomb",terror:"terrorsaur",primal:"optimus-primal",thunder:"thundercracker"};
export const rosters=Object.fromEntries(Object.entries(rows).map(([faction,units])=>[faction,units.map(([id,name,role,max,dmg,ability,abilityUses])=>({id,name,role,max,hp:max,dmg,ability,abilityUses,canAttack:true,faction:faction as Faction,image:`/cards/characters/${imageNames[id]||id}.png`,shield:id==="terror"?1:0}))])) as Record<Faction,Unit[]>;
export const allUnits=Object.values(rosters).flat();

export const battleCards:Record<string,BattleInfo>={
  "2 For The Price Of 1":{rarity:"Common",effect:"After an enemy dies, the opponent reveals another occupied position.",image:"/cards/battle/two-for-one.png"},
  "Armor Plating":{rarity:"Common",effect:"Reduce the next damage dealt to one character by 10.",image:"/cards/battle/armor-plating.png"},
  "Dark Reflections":{rarity:"Common",effect:"Collect 2, scrap both, and replace an attacker's Damage with a defeated character's Damage.",image:"/cards/battle/dark-reflections.png"},
  "Deserved Punishment":{rarity:"Common",effect:"Choose an enemy position and deal 10 damage if occupied.",image:"/cards/battle/deserved-punishment.png"},
  "Face Off":{rarity:"Common",effect:"If your next attack hits, draw a Battle Card.",image:"/cards/battle/face-off.png"},
  "Flying Support":{rarity:"Common",effect:"Force the opponent to reveal one character position.",image:"/cards/battle/flying-support.png"},
  "He Will Find You":{rarity:"Common",effect:"Reveal the position of the enemy character with the lowest Health.",image:"/cards/battle/he-will-find-you.png"},
  "Reinforce":{rarity:"Common",effect:"Exchange one deployed character with a Backup without a Reposition Action.",image:"/cards/battle/reinforce.png"},
  "Roll Out":{rarity:"Common",effect:"Heal one character by 10.",image:"/cards/battle/roll-out.png"},
  "Tyrants Reign":{rarity:"Common",effect:"Draw 2 more Battle Cards.",image:"/cards/battle/tyrants-reign.png"},
  "Surprise":{rarity:"Common",effect:"Pick 2 spaces and learn whether a character is there.",image:"/cards/battle/surprise.png"},
  "Information Gathering":{rarity:"Rare",effect:"Force the opponent to reveal 3 deployed character positions.",image:"/cards/battle/information-gathering.png"},
  "Junkion Scrap":{rarity:"Rare",effect:"The opponent scraps 3 Battle Cards.",image:"/cards/battle/junkion-scrap.png"},
  "Power Of The Primes":{rarity:"Rare",effect:"Heal one character by 35.",image:"/cards/battle/power-of-the-primes.png"},
  "War Dawn":{rarity:"Rare",effect:"Choose an enemy row; everyone in it takes 15 damage.",image:"/cards/battle/war-dawn.png"},
  "Ambush Trap":{rarity:"Common",effect:"Place on a vacant friendly space. If attacked, cancel the hit and reveal the attacking enemy position.",image:""},
};
export const battleDeck=Object.keys(battleCards);
export const shuffled=<T,>(items:T[])=>[...items].sort(()=>Math.random()-.5);
export const makeBattleDeck=()=>{const cards=battleDeck.flatMap(name=>[name,name]);cards.splice(cards.indexOf("Ambush Trap"),1);cards.splice(cards.indexOf("Surprise"),1);return shuffled(cards)};
export const enemyDeck=(faction:Faction)=>{const base=rosters[faction].map(x=>({...x}));while(base.length<9)base.push(...rosters.Autobot.slice(0,9-base.length).map(x=>({...x})));return base.slice(0,9)};
export const randomEnemyDeck=()=>{const limits:Record<Role,number>={Commander:2,Scout:3,Trooper:2,Tactician:2};return (Object.entries(limits) as [Role,number][]).flatMap(([role,amount])=>shuffled(allUnits.filter(unit=>unit.role===role)).slice(0,amount).map(unit=>({...unit,hp:unit.max,shield:unit.id==="terror"?1:0})))};
