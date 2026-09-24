import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate, defaults} from '../dist/engine.js';
test('24 hours conserve energy and respect battery and power limits',()=>{
 for(const mode of ['saving','balanced','backup']) for(const storm of [false,true]) {
  const p=calculate({...defaults,mode,storm});
  assert.equal(p.hours.length,24);
  for(const h of p.hours){ assert.ok(h.soc>=0 && h.soc<=95.001); assert.ok(h.charge<=2.5 && h.discharge<=2.5); assert.ok(Math.abs(h.pv+h.grid+h.discharge-h.load-h.charge-h.export)<1e-8); assert.ok(h.soc>=p.reserve-1e-8); }
  assert.ok(Number.isFinite(p.savings));
 }
});
test('storm raises reserve and decreases solar forecast',()=>{
 const normal=calculate(defaults), storm=calculate({...defaults,storm:true});
 assert.ok(storm.reserve>normal.reserve); assert.ok(storm.solar<normal.solar);
});
test('reserve responds to essential load and requested duration; infeasible goals warned',()=>{
 const p=calculate({...defaults,backupHours:12,devices:['fridge','router','lights','heat']});
 assert.ok(p.reserve<=95);assert.equal(p.insufficient,true);
 const empty=calculate({...defaults,devices:[]});assert.equal(empty.backupHours,0);assert.ok(Number.isFinite(empty.reserve));
});
test('washing task finishes before next morning deadline and cancellation removes load',()=>{
 const p=calculate({...defaults,laundry:true,deadline:7});
 assert.ok(p.laundryStart+2<=7);assert.ok(p.laundryStart>=0);
 assert.ok(p.hours.reduce((a,h)=>a+h.load,0)>calculate(defaults).hours.reduce((a,h)=>a+h.load,0));
 assert.equal(calculate(defaults).laundryStart,null);
});
test('preferences produce distinct reserves and dinner timing changes load',()=>{
 assert.ok(calculate({...defaults,mode:'backup'}).reserve>calculate({...defaults,mode:'saving'}).reserve);
 assert.notEqual(calculate({...defaults,dinner:17}).hours[17].load,calculate({...defaults,dinner:20}).hours[17].load);
});
test('balanced plan saves against fixed self-use without borrowing end-of-day battery energy',()=>{
 const p=calculate(defaults);assert.ok(p.savings>0);assert.ok(p.hours[23].soc>=p.baseEndSoc-1e-6);
 assert.ok(p.hours.some(h=>h.charge>0&&h.pv===0));
});
