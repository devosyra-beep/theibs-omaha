'use strict';
// Fixed-design inference. The inferential unit for prediction is a complete,
// independent 100-hand block, never overlapping windows or decisions.
function mean(xs) { return xs.reduce((a,b)=>a+b,0)/xs.length; }
function variance(xs) { const m=mean(xs); return xs.length>1?xs.reduce((a,x)=>a+(x-m)**2,0)/(xs.length-1):null; }
function checked(xs,lower,upper,alpha) {
  if(!Array.isArray(xs)||!xs.length||xs.some(x=>!Number.isFinite(x)||x<lower-1e-8||x>upper+1e-8)||!(lower<upper)||!(alpha>0&&alpha<1))throw Error('Invalid economic sample/support/alpha.');
}
function boundedMeanCI(xs,{lower,upper,alpha=.05}) {
  checked(xs,lower,upper,alpha);
  const n=xs.length,m=mean(xs),width=upper-lower,log=Math.log(4/alpha);
  // Two-sided empirical Bernstein (sample variance); fixed N, bounded IID.
  const radius=n<2?Infinity:Math.sqrt(2*variance(xs)*log/n)+7*width*log/(3*(n-1));
  return {lower:Math.max(lower,m-radius),upper:Math.min(upper,m+radius),level:1-alpha,method:'FIXED_N_EMPIRICAL_BERNSTEIN',n,support:[lower,upper]};
}
function logBinomialTail(k,n,p) {
  if(k<=0)return 1;if(p===0)return 0;if(p===1)return 1;
  let logChoose=0;for(let i=1;i<=k;i++)logChoose+=Math.log(n-i+1)-Math.log(i);
  let logTerm=logChoose+k*Math.log(p)+(n-k)*Math.log1p(-p),maxLog=logTerm,scaledSum=1;
  for(let i=k;i<n;i++){logTerm+=Math.log(n-i)-Math.log(i+1)+Math.log(p)-Math.log1p(-p);if(logTerm>maxLog){scaledSum=scaledSum*Math.exp(maxLog-logTerm)+1;maxLog=logTerm;}else scaledSum+=Math.exp(logTerm-maxLog);}
  return Math.min(1,Math.exp(maxLog)*scaledSum);
}
function binomialLower(k,n,alpha) {
  if(k===0)return 0;if(k===n)return alpha**(1/n);
  let low=0,high=1;for(let i=0;i<65;i++){const m=(low+high)/2;if(logBinomialTail(k,n,m)<alpha)low=m;else high=m;}return (low+high)/2;
}
function probabilityCI(k,n,alpha=.05) {
  if(!Number.isInteger(n)||n<1||!Number.isInteger(k)||k<0||k>n||!(alpha>0&&alpha<1))throw Error('Invalid binomial count.');
  return {lower:binomialLower(k,n,alpha/2),upper:1-binomialLower(n-k,n,alpha/2),level:1-alpha,method:'CLOPPER_PEARSON_TWO_SIDED',n};
}
function quantile(xs,p) {const s=[...xs].sort((a,b)=>a-b),i=(s.length-1)*p,l=Math.floor(i);return s[l]+(s[Math.ceil(i)]-s[l])*(i-l);}
function predictiveInterval(xs,{lower,upper,alpha=.1}) {
  checked(xs,lower,upper,alpha);
  const sorted=[...xs].sort((a,b)=>a-b),k=Math.floor(alpha*(xs.length+1)/2);
  // Under exchangeability, the rank of the NEXT block is uniform (ties only
  // increase coverage). For too few blocks use physical support, not an
  // empirical quantile advertised as a calibrated prediction interval.
  return k<1?{lower,upper,coverage:1,requestedCoverage:1-alpha,method:'PHYSICAL_SUPPORT_INSUFFICIENT_BLOCKS',status:'UNINFORMATIVE'}:
    {lower:sorted[k-1],upper:sorted[xs.length-k],coverage:1-2*k/(xs.length+1),requestedCoverage:1-alpha,method:'EXCHANGEABLE_ORDER_STATISTICS',status:'FINITE_SAMPLE_MARGINAL'};
}
function normalQuantile(p) {
  if(!(p>0&&p<1))throw Error('Invalid normal quantile.');
  const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];
  if(p<.02425){const q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p>.97575)return -normalQuantile(1-p);
  const q=p-.5,r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
function planPower({sdBB100,alpha,power=.8,nullBB100=1,alternativeBB100=3}) {
  if(!(sdBB100>=0)||!(alternativeBB100>nullBB100))throw Error('Invalid planning assumptions.');
  const blocks=Math.max(2,Math.ceil(((normalQuantile(1-alpha)+normalQuantile(power))*sdBB100/(alternativeBB100-nullBB100))**2));
  return {method:'NORMAL_APPROXIMATION_PLANNING_ONLY',sdBB100,alpha,power,nullBB100,alternativeBB100,requiredIndependentBlocks:blocks,requiredHands:blocks*100,limitation:'Pilot variance is uncertain; this is not achieved power or a stopping rule. Confirm with a new fixed protocol and calibration.'};
}
function describeDistribution(outcomes) {
  if(!outcomes.length||outcomes.some(o=>!Number.isFinite(o.value)||!(o.probability>=0))||Math.abs(outcomes.reduce((s,o)=>s+o.probability,0)-1)>1e-9)throw Error('Invalid distribution.');
  return {expectation:outcomes.reduce((s,o)=>s+o.value*o.probability,0),pPositive:outcomes.filter(o=>o.value>0).reduce((s,o)=>s+o.probability,0)};
}
module.exports={mean,variance,boundedMeanCI,probabilityCI,quantile,predictiveInterval,normalQuantile,planPower,describeDistribution};
