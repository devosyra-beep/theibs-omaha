(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsContinuationView = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Translate the signed engine assessment; never derive a signal from color,
  // hand category, the point equity alone, or a missing BET/RAISE comparison.
  function describe(assessment) {
    if (!assessment) return null;
    const views = {
      FAVORABLE: {tone:'positive',state:'CALL favorable in this model',title:'Favorable price to call',shortTitle:'Favorable CALL',detail:'Even the lower bound of calculated EV is positive with the entered costs. This evaluates CALL against folding.',uncertain:false},
      UNFAVORABLE: {tone:'negative',state:'CALL unfavorable in this model',title:'Unfavorable price to call',shortTitle:'Unfavorable CALL',detail:'Even the upper bound of calculated EV is negative. In this model, calling costs more than the expected share of the pot.',uncertain:false},
      UNCERTAIN: {tone:'neutral',state:'Uncertain margin',title:'Not enough margin to conclude yet',shortTitle:'Uncertain margin',detail:'The EV range touches zero or has no valid bounds. A positive point estimate alone is not enough to recommend a call.',uncertain:true,target:'precision',label:'View precision'},
      FREE_CHECK: {tone:'neutral',state:'Free CHECK now',title:'You can CHECK for free',shortTitle:'Free CHECK',detail:'There is no bet to call in this decision. This does not mean your hand is strong: reassess if a bet or another card arrives.',uncertain:false},
      PROVISIONAL: {tone:'pending',state:'Preview · awaiting result',title:'Calculating CALL margin',shortTitle:'Calculating…',detail:'This is a preview. A signal appears only after the final calculation.',uncertain:true},
      UNAVAILABLE: {tone:'pending',state:'No CALL assessment',title:'More data is needed to assess this price',shortTitle:'CALL unavailable',detail:'Equity may be available, but CALL does not yet have a valid model for this decision.',uncertain:true,target:'calculation',label:'See what is missing'}
    };
    const view = {...(views[assessment.status] || views.UNAVAILABLE),target:views[assessment.status]?.target || null};
    if(assessment.reasonCodes?.includes('COSTS_REQUIRED'))Object.assign(view,{detail:'Enter the table rake or explicitly confirm zero cost. Without this, there is no net EV signal.',target:'costs',label:'Enter costs'});
    if(assessment.reasonCodes?.includes('INCOMPLETE_OPPONENT_COVERAGE'))view.detail='The calculation does not cover every opponent at this table. Complete coverage before interpreting CALL.';
    if(assessment.boundsKind==='CONDITIONAL_ENVELOPE')view.detail+=' The ranges depend on the entered response assumptions; they are not a probability of profit.';
    return view;
  }
  return {describe};
});
