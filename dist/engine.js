export const defaults={mode:'balanced',storm:false,dinner:18,backupHours:4,devices:['fridge','router','lights'],laundry:false,deadline:7,paused:false};
export const appliances={fridge:{name:'冰箱',power:.12},router:{name:'网络与安防',power:.015},lights:{name:'基础照明',power:.065},heat:{name:'暖气循环泵',power:.65}};
export const prices=[.23,.21,.18,.14,.15,.19,.25,.31,.29,.26,.23,.20,.17,.16,.18,.22,.29,.38,.42,.39,.33,.29,.26,.24];
const sun=[0,0,0,0,0,0,.1,.35,.7,1.2,1.8,2.3,2.7,2.5,2.1,1.6,.9,.35,.08,0,0,0,0,0];
const capacity=10,chargeEfficiency=.95,dischargeEfficiency=.9,maxPower=2.5;
export function calculate(input){
 const s={...defaults,...input};
 const essential=s.devices.reduce((a,id)=>a+(appliances[id]?.power||0),0);
 const needed=essential*s.backupHours/dischargeEfficiency;
 const reserve=Math.min(95,Math.max(({saving:20,balanced:30,backup:70})[s.mode],s.storm?65:0,Math.ceil(needed/capacity*100)));
 let laundryStart=null;
 if(s.laundry){let cheapest=Infinity;for(let h=0;h<=s.deadline-2;h++){const cost=prices[h]*.65+prices[h+1]*.35;if(cost<cheapest){cheapest=cost;laundryStart=h;}}}
 const loads=Array.from({length:24},(_,h)=>.30+(h>=6&&h<=8?.7:0)+(h>=s.dinner&&h<s.dinner+2?2.4:0)+(h>=20&&h<=22?.4:0)+(h>=10&&h<=16?.14:0));
 if(laundryStart!==null){loads[laundryStart]+=.65;loads[laundryStart+1]+=.35;}
 const solarForecast=sun.map(v=>v*.55*(s.storm?.35:1));
 let baseEnergy=6.8,baseline=0,baseExport=0;
 for(let h=0;h<24;h++){
  const net=Math.max(0,loads[h]-solarForecast[h]),surplus=Math.max(0,solarForecast[h]-loads[h]);
  const charge=Math.min(surplus,maxPower,(9.5-baseEnergy)/chargeEfficiency),discharge=Math.max(0,Math.min(net,maxPower,(baseEnergy-3)*dischargeEfficiency));
  baseEnergy+=charge*chargeEfficiency-discharge/dischargeEfficiency;
  const feed=surplus-charge;baseline+=(net-discharge)*prices[h]-feed*.08;baseExport+=feed;
 }
 // Optimize hourly transitions on a 0.1 kWh grid with a terminal stock constraint.
 const cyclePenalty={saving:.005,balanced:.015,backup:.025}[s.mode];
 let costs=new Float64Array(96).fill(Infinity);costs[68]=0;
 const parents=[];
 for(let h=0;h<24;h++){
  const next=new Float64Array(96).fill(Infinity),prev=new Int16Array(96).fill(-1);
  const demand=loads[h]-solarForecast[h];
  for(let e=0;e<=95;e++){
   if(!Number.isFinite(costs[e]))continue;
   // Targets above opening stock are refilled as quickly as the power limit permits.
   const floor=e<reserve?Math.min(reserve,e+23):reserve;
   for(let n=Math.max(floor,e-28);n<=Math.min(95,e+23);n++){
    const charge=Math.max(0,(n-e)/10/chargeEfficiency),discharge=Math.max(0,(e-n)/10*dischargeEfficiency);
    if(charge>maxPower+1e-9||discharge>maxPower+1e-9||discharge>Math.max(0,demand)+1e-9)continue;
    const balance=demand+charge-discharge,grid=Math.max(0,balance),feed=Math.max(0,-balance);
    const cost=costs[e]+grid*prices[h]-feed*.08+discharge*cyclePenalty;
    if(cost<next[n]){next[n]=cost;prev[n]=e;}
   }
  }
  parents.push(prev);costs=next;
 }
 const terminalFloor=Math.max(reserve,Math.ceil(baseEnergy*10-1e-8));
 let end=terminalFloor;for(let n=terminalFloor;n<=95;n++)if(costs[n]<costs[end])end=n;
 if(!Number.isFinite(costs[end]))throw new Error('No feasible energy plan');
 const states=new Array(25);states[24]=end;for(let h=23;h>=0;h--)states[h]=parents[h][states[h+1]];
 let cost=0,solar=0,exported=0,throughput=0;
 const hours=prices.map((price,h)=>{
  const pv=solarForecast[h],load=loads[h],charge=Math.max(0,(states[h+1]-states[h])/10/chargeEfficiency),discharge=Math.max(0,(states[h]-states[h+1])/10*dischargeEfficiency);
  const balance=load-pv+charge-discharge,grid=Math.max(0,balance),feed=Math.max(0,-balance);
  let action='保持',color='hold',reason=s.storm?'保留电量应对强风风险，暂不进行额外套利。':'综合接下来电价与太阳能预测，暂不充放电，避免不必要的电池损耗。';
  if(charge>.005){
   const solarOnly=grid<=Math.max(0,load-pv)+.001;
   action=solarOnly?'光伏充电':'电网充电';color=solarOnly?'solar':'charge';
   reason=solarOnly?'太阳能超过家庭所需，把多余电量存起来，留给晚间使用。':states[h]<reserve?'当前储备低于保障目标，优先补足关键设备所需电量。':`此时电价 €${price.toFixed(2)}/kWh，结合次日光伏与 ${s.dinner}:00 的晚餐需求，提前补足电量。`;
  }else if(discharge>.005){action='电池供电';color='discharge';reason=`用储存的电减少 €${price.toFixed(2)}/kWh 的电网购电，同时保留至少 ${reserve}% 电量。`;}
  else if(feed>.005){action='余电上网';color='solar';reason='家庭用电已满足，当前储能空间或后续需求有限，将剩余太阳能送回电网。';}
  else if(pv>0){action='光伏供电';color='solar';reason='太阳能优先供给家庭，电池保持待命。';}
  cost+=grid*price-feed*.08;solar+=pv;exported+=feed;throughput+=discharge;
  return {hour:h,price,pv,load,soc:states[h+1],grid,charge,discharge,export:feed,action,color,reason};
 });
 return {hours,reserve,essential,backupHours:essential?reserve/100*capacity*dischargeEfficiency/essential:0,insufficient:needed>9.5,cost,baseline,baseEndSoc:baseEnergy*10,savings:baseline-cost,solar,selfUse:solar?(solar-exported)/solar*100:0,baseSelfUse:solar?(solar-baseExport)/solar*100:0,cycles:throughput/capacity,laundryStart,laundryCost:laundryStart===null?0:prices[laundryStart]*.65+prices[laundryStart+1]*.35};
}
