import type {MeshValidation} from './gearMath.ts';
import type {ModelMesh} from './model.ts';

export type PrintSettings={bedX:number;bedY:number;bedZ:number;nozzle:number;lineWidth:number;layer:number;material:string};
export const defaultPrintSettings:PrintSettings={bedX:256,bedY:256,bedZ:256,nozzle:.4,lineWidth:.45,layer:.16,material:'PETG'};
export type PrintCheck={id:string;label:string;status:'pass'|'warning'|'fail';detail:string};

export function assessPrint(mesh:ModelMesh,validation:MeshValidation,s:PrintSettings){
 const values=[s.bedX,s.bedY,s.bedZ,s.nozzle,s.lineWidth,s.layer];
 if(values.some(x=>!Number.isFinite(x)||x<=0))throw new Error('Размеры стола, сопла, линии и слоя должны быть положительными.');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<mesh.positions.length;i++){const a=i%3;min[a]=Math.min(min[a],mesh.positions[i]);max[a]=Math.max(max[a],mesh.positions[i]);}
 const size=max.map((v,i)=>v-min[i]);
 const fit=(size[0]+10<=s.bedX&&size[1]+10<=s.bedY)||(size[1]+10<=s.bedX&&size[0]+10<=s.bedY);
 const d=mesh.dimensions,p=mesh.params,worm='wormDimensions' in mesh?mesh.wormDimensions:null;
 const internal=p.kind==='internal'||p.kind==='internal-helical',rack=p.kind==='rack'||p.kind==='helical-rack';
 const wall=internal?(p.rimThickness??3*p.module):rack?(p.rackBaseHeight??3*p.module):(d.rootDiameter-p.bore)/2;
 const fmt=(n:number)=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});
 const orientation=rack?'Текущая ориентация: ширина рейки по оси Z.':'Текущая ориентация: ось детали вертикальна.';
 const checks:PrintCheck[]=[
  {id:'mesh',label:'Замкнутая сетка',status:validation.valid?'pass':'fail',detail:validation.valid?`${validation.triangles.toLocaleString('ru-RU')} треугольников; рёбра и ориентация проверены. Самопересечения отдельно не проверялись.`:'Сетка не прошла проверку.'},
  {id:'bed',label:'Габариты на столе',status:fit&&size[2]<=s.bedZ?'pass':'fail',detail:`${size.map(fmt).join(' × ')} мм. По 5 мм запаса по краям. ${orientation}${p.kind==='helical-rack'?' Учтён сдвиг торцов косозубой рейки.':''}`},
 ];
 if(worm){
  // The compatibility tipThickness is a transverse ARC, not a small axial thread feature.
  // On the unrolled tip cylinder, normal strip width = axial width * cos(local lead angle).
  const tipLeadAngle=Math.atan(worm.lead/(Math.PI*d.tipDiameter));
  const normalTip=worm.axialTipThickness*Math.cos(tipLeadAngle);
  checks.push(
   {id:'tip',label:'Вершина витка ZA',status:normalTip<2*s.lineWidth?'warning':'pass',detail:`Осевой размер ${fmt(worm.axialTipThickness)} мм; нормальная ширина на развёртке цилиндра вершин ${fmt(normalTip)} мм. Это не ширина дорожки в XY. Сравнение с двумя линиями (${fmt(2*s.lineWidth)} мм) — предварительный ориентир; проверьте траектории в слайсере.`},
   {id:'worm-layer',label:'Осевой размер и слой',status:worm.axialTipThickness<2*s.layer?'warning':'pass',detail:`На осевую вершину приходится ${fmt(worm.axialTipThickness/s.layer)} слоя при высоте ${fmt(s.layer)} мм. Менее двух слоёв — риск потери формы витка; это геометрический ориентир, не допуск изготовления.`},
  );
 }else{
  checks.push({id:'tip',label:'Толщина вершины зуба',status:d.tipThickness<s.lineWidth?'fail':d.tipThickness<2*s.lineWidth?'warning':'pass',detail:`${fmt(d.tipThickness)} мм в поперечном сечении / ширина линии ${fmt(s.lineWidth)} мм. Ориентир — две линии; фактическое перекрытие периметров рассчитывает слайсер.`});
 }
 checks.push(
  {id:'wall',label:rack?'Основание рейки':internal?'Обод за впадинами':worm?'Материал под витками':'Материал под зубьями',status:wall<s.lineWidth?'fail':wall<2*s.lineWidth?'warning':'pass',detail:`${rack?'Высота основания':'Радиальный запас материала'} ${fmt(wall)} мм.`},
  {id:'layer',label:'Слой и сопло',status:s.layer<=.8*s.nozzle&&s.lineWidth>=.8*s.nozzle&&s.lineWidth<=1.5*s.nozzle?'pass':'warning',detail:`Слой ${fmt(s.layer)} мм, сопло ${fmt(s.nozzle)} мм. Ориентир слоя ≤ 80% диаметра сопла; ширину линии проверьте в профиле слайсера.`},
 );
 if(worm)checks.push({id:'overhang',label:'Винтовые нависания и опоры',status:'warning',detail:'При вертикальной оси нижняя боковина каждого витка может требовать опор. Нужны послойный просмотр и пробная печать; следы опор на рабочих боковинах влияют на контакт с червячным колесом.'});
 else if(['helical','herringbone','internal-helical','helical-rack'].includes(p.kind))checks.push({id:'overhang',label:'Наклон и опоры',status:'warning',detail:'Проверьте нависания и прилегание первого слоя в слайсере. Следы опор на рабочих боковинах могут ухудшить зацепление.'});
 if(mesh.warnings.some(w=>w.code==='UNDERCUT'))checks.push({id:'undercut',label:'Подрезание зуба',status:'warning',detail:'Есть риск подрезания. Проверьте профиль и ответное колесо до изготовления.'});
 const limitations=mesh.warnings.filter(w=>w.code==='SIMPLIFIED_ROOT'||w.code==='INTERNAL_PAIR'||w.code==='WORM_SHARP_TRANSITIONS'||w.code==='WORM_PAIR_REQUIRED');
 if(limitations.length)checks.push({id:'geometry',label:'Ограничения геометрии',status:'warning',detail:limitations.map(w=>w.message).join(' ')});
 return {status:checks.some(c=>c.status==='fail')?'fail':checks.some(c=>c.status==='warning')?'warning':'pass',size,checks,volumeMm3:validation.signedVolume,material:s.material,disclaimer:'Это геометрическая оценка пробной печати. Прочность, момент, ресурс, точность посадок и работа с ответной деталью не подтверждены.'};
}
