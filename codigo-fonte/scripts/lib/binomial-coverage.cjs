'use strict';
// Exact one-sided Clopper-Pearson lower limit, by inversion of a binomial tail.
// Log probabilities avoid underflow near all-success and all-failure samples.
function upperTail(successes,n,p) {
  if(successes<=0)return 1;if(p===0)return 0;if(p===1)return 1;
  let logChoose=0;
  for(let i=1;i<=successes;i++)logChoose+=Math.log(n-i+1)-Math.log(i);
  let term=Math.exp(logChoose+successes*Math.log(p)+(n-successes)*Math.log1p(-p)),sum=term;
  for(let k=successes;k<n;k++){term*=((n-k)/(k+1))*(p/(1-p));sum+=term;}
  return Math.min(1,sum);
}
function lowerBound(successes,n,alpha=.05) {
  if(!Number.isInteger(n)||n<1||!Number.isInteger(successes)||successes<0||successes>n||!(alpha>0&&alpha<1))throw Error('Invalid binomial confidence input.');
  if(successes===0)return 0;if(successes===n)return alpha**(1/n);
  let low=0,high=1;
  for(let i=0;i<70;i++){const mid=(low+high)/2;if(upperTail(successes,n,mid)<alpha)low=mid;else high=mid;}
  return (low+high)/2;
}
module.exports={lowerBound,upperTail};
