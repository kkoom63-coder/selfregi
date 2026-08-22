/* 회귀 테스트 — 실제 OCR 원문 4종. 한 군데 고칠 때마다 전부 통과해야 한다. */
var fs=require('fs'), R=require('/home/claude/regfields.js');
var CASES=[
 {f:'sindang', exp:{docType:'집합건물',uid:'1103-1996-279658',
   jibunAddress:'서울특별시 중구 신당동 372-13', exclusiveNo:'제2층 제207호',
   exclusiveStruct:'철근콘크리트조', exclusiveArea:'52.69', ratio:'55분의 1',
   roadAddress:'서울특별시 중구 동호로 173',
   owners:[['김서준','단독소유',true]]}},
 {f:'ssangchon', exp:{docType:'집합건물',uid:'2001-2025-007301',
   jibunAddress:'전남광주통합특별시 서구 쌍촌동 1393 상무센트럴자이 제101동',
   exclusiveNo:'제2층 제201호', exclusiveStruct:'철근콘크리트구조', exclusiveArea:'125.13',
   ratio:'63527.1분의 75.809', roadAddress:'전남광주통합특별시 서구 상무민주로32번길 10',
   owners:[['박지훈','2분의 1',true],['최유진','2분의 1',true]]}},
 {f:'seocho', exp:{docType:'집합건물',uid:'1101-2017-007622',
   jibunAddress:'서울특별시 서초구 서초동 1338-8 강남역파라디아골드주건축물 제1동',
   exclusiveNo:'제16층 제1606호', exclusiveStruct:'철근콘크리트구조', exclusiveArea:'20.16',
   ratio:'568.3분의 3.6', roadAddress:'서울특별시 서초구 효령로 79길 1',
   owners:[['정민호','2분의 1',true],['한소영','2분의 1',true]]}},
 {f:'toji', exp:{docType:'토지',uid:'1712-1996-281374',
   jibunAddress:'경상북도 경주시 양남면 상계리 295', exclusiveNo:'', exclusiveStruct:'',
   exclusiveArea:'', ratio:'', roadAddress:'',
   owners:[['주식회사가나개발',null,false]]}}
];
var fail=0;
function eq(tag,got,want){
  var ok = String(got||'')===String(want||'');
  if(!ok){ fail++; console.log('  ✗ '+tag+'\n      got  '+JSON.stringify(got)+'\n      want '+JSON.stringify(want)); }
  return ok;
}
CASES.forEach(function(c){
  var txt=fs.readFileSync('/home/claude/fixtures/'+c.f+'.txt','utf8');
  var r=R.extract(txt), P=r.property, e=c.exp, n0=fail;
  console.log('['+c.f+']');
  eq('docType',r.docType,e.docType); eq('uid',r.uid,e.uid);
  eq('소재지번',P.jibunAddress,e.jibunAddress);
  eq('층호',P.exclusiveNo,e.exclusiveNo);
  eq('구조',P.exclusiveStruct,e.exclusiveStruct);
  eq('전유면적',P.exclusiveArea,e.exclusiveArea);
  eq('대지권비율',P.landRightRatio?P.landRightRatio.denom+'분의 '+P.landRightRatio.num:'',e.ratio);
  eq('도로명',P.roadAddress,e.roadAddress);
  eq('소유자수',r.owners.length,e.owners.length);
  e.owners.forEach(function(o,i){
    var g=r.owners[i]||{};
    eq('소유자'+(i+1)+'.이름',g.name,o[0]);
    eq('소유자'+(i+1)+'.지분',g.shareRaw,o[1]);
    eq('소유자'+(i+1)+'.주소있음',!!g.registryAddress,o[2]);
  });
  if(fail===n0) console.log('  ✓ 통과');
});
console.log(fail? '\n실패 '+fail+'건' : '\n전부 통과');
process.exit(fail?1:0);
