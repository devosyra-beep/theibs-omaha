'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patchDOM}=require('../public/simulation-tools');
// Small DOM adapter: assertions concern retained control identity, domain
// attributes and user disclosure state, not serialized CSS or markup snapshots.
function element(name,attrs={},children=[]){
  const node={nodeType:1,nodeName:name.toUpperCase(),tagName:name.toUpperCase(),attrs:{...attrs},childNodes:[],parentNode:null,
    get id(){return this.attrs.id||'';},get className(){return this.attrs.class||'';},
    get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));},
    hasAttribute(name){return Object.hasOwn(this.attrs,name);},getAttribute(name){return this.attrs[name]??null;},
    setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
    insertBefore(child,before){child.remove();const at=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(at,0,child);child.parentNode=this;},
    remove(){if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}},
    cloneNode(){return element(name,this.attrs,this.childNodes.map(child=>child.cloneNode(true)));}};
  for(const child of children)node.insertBefore(child,null);
  return node;
}
function text(value){return {nodeType:3,nodeName:'#text',nodeValue:value,parentNode:null,
  remove(){if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}},
  cloneNode(){return text(this.nodeValue);}};}
test('EV refresh keeps the native selector, table, focused action and user-open details in place',()=>{
  const select=element('select',{id:'sim-control'});select.value='STEP';
  const action=element('button',{'data-sim-op':'SIZE','data-action':'RAISE','data-to':'3'},[text('Raise to 3')]);
  const table=element('div',{class:'sim-table-wrap'},[text('Pot 1.5')]);
  const details=element('details',{class:'sim-hand-tools',open:''},[element('summary',{},[text('Hand options')])]);
  const host=element('section',{id:'simulation-workspace',class:'simulation-workspace'},[table,select,action,details]);
  const nextSelect=element('select',{id:'sim-control'});nextSelect.value='AUTO';
  patchDOM(host,element('div',{},[element('div',{class:'sim-table-wrap'},[text('Pot 4.5')]),nextSelect,
    element('button',{'data-sim-op':'SIZE','data-action':'RAISE','data-to':'9',disabled:''},[text('Raise to 9')]),
    element('details',{class:'sim-hand-tools'},[element('summary',{},[text('Hand options')])])]));
  assert.equal(host.id,'simulation-workspace');assert.equal(host.className,'simulation-workspace');
  assert.equal(host.childNodes[0],table);assert.equal(table.childNodes[0].nodeValue,'Pot 4.5');
  assert.equal(host.childNodes[1],select);assert.equal(select.value,'AUTO');
  assert.equal(host.childNodes[2],action);assert.equal(action.getAttribute('data-to'),'9');assert.equal(action.hasAttribute('disabled'),true);
  assert.equal(host.childNodes[3],details);assert.equal(details.hasAttribute('open'),true);
});
test('turn changes cannot reuse a focused control for a different poker action',()=>{
  const call=element('button',{'data-sim-op':'ACT','data-action':'CALL'},[text('Call 1')]);
  const raise=element('button',{'data-sim-op':'SIZE','data-action':'RAISE'},[text('Raise')]);
  const host=element('div',{},[call,raise]);
  patchDOM(host,element('div',{},[element('button',{'data-sim-op':'SIZE','data-action':'RAISE'},[text('Raise to 3')]),
    element('button',{'data-sim-op':'ACT','data-action':'CHECK'},[text('Check')])]));
  assert.equal(host.childNodes[0],raise);assert.equal(call.parentNode,null);
  assert.notEqual(host.childNodes[1],call);assert.equal(host.childNodes[1].getAttribute('data-action'),'CHECK');
  assert.equal(host.childNodes.length,2);
});
