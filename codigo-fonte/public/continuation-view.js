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
      FAVORABLE: {tone:'positive',state:'CALL favorável no modelo',title:'Preço favorável para pagar',shortTitle:'CALL favorável',detail:'Mesmo o limite inferior do EV calculado é positivo, com os custos informados. Isso avalia este CALL contra desistir.',uncertain:false},
      UNFAVORABLE: {tone:'negative',state:'CALL desfavorável no modelo',title:'Preço desfavorável para pagar',shortTitle:'CALL desfavorável',detail:'Até o limite superior do EV calculado é negativo. Neste modelo, pagar custa mais do que a participação esperada no pote.',uncertain:false},
      UNCERTAIN: {tone:'neutral',state:'Margem incerta',title:'Ainda sem margem para concluir',shortTitle:'Margem incerta',detail:'A faixa de EV toca zero ou não há limites válidos. Um valor pontual positivo não basta para dar sinal verde.',uncertain:true,target:'precision',label:'Ver precisão'},
      FREE_CHECK: {tone:'neutral',state:'CHECK sem custo agora',title:'Você pode dar CHECK sem pagar',shortTitle:'CHECK sem custo',detail:'Não há aposta para cobrir nesta decisão. Isso não significa mão forte: reavalie se vier uma aposta ou outra carta.',uncertain:false},
      PROVISIONAL: {tone:'pending',state:'Prévia · aguardando resultado',title:'Calculando a margem do CALL',shortTitle:'Calculando…',detail:'Esta é uma prévia. O sinal só aparece após o cálculo final.',uncertain:true},
      UNAVAILABLE: {tone:'pending',state:'Sem avaliação do CALL',title:'Faltam dados para avaliar este preço',shortTitle:'CALL indisponível',detail:'A equity pode estar disponível, mas o CALL ainda não tem um modelo válido para esta decisão.',uncertain:true,target:'calculation',label:'Ver o que falta'}
    };
    const view = {...(views[assessment.status] || views.UNAVAILABLE),target:views[assessment.status]?.target || null};
    if(assessment.reasonCodes?.includes('COSTS_REQUIRED'))Object.assign(view,{detail:'Informe o rake da mesa ou confirme explicitamente custo zero. Sem isso, não há sinal de EV líquido.',target:'costs',label:'Informar custos'});
    if(assessment.reasonCodes?.includes('INCOMPLETE_OPPONENT_COVERAGE'))view.detail='O cálculo não cobre todos os adversários desta mesa. Complete a cobertura antes de interpretar o CALL.';
    if(assessment.boundsKind==='CONDITIONAL_ENVELOPE')view.detail+=' As faixas dependem das hipóteses de resposta fornecidas; não são uma probabilidade de lucro.';
    return view;
  }
  return {describe};
});
