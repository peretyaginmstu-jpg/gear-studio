"use client";
import { useId, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Ruler, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { measurementLessons, knownMeasurementKind, type MeasurementGuideContext, type MeasurementTopic } from '@/lib/measurementGuide';
import { modelNames } from '@/lib/model';
import { useActivePopup } from './useActivePopup';
import { MeasurementIllustration } from './MeasurementIllustration';

export function MeasurementGuide({ active = true, kind, teeth, source = 'manual', initialTopic = 'capture', label = 'Как снять и измерить', hint = 'Покажем на схеме' }: MeasurementGuideContext & {
  active?: boolean; initialTopic?: MeasurementTopic; label?: string; hint?: string;
}) {
  const popup = useActivePopup(active), [selected, setSelected] = useState(initialTopic), contentId = useId();
  const lessons = measurementLessons({ kind, teeth, source }), lesson = lessons.find(item => item.topic === selected) ?? lessons[0];
  const modelKind = knownMeasurementKind(kind), title = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const choose = (topic: MeasurementTopic) => {
    setSelected(topic);
    requestAnimationFrame(() => { title.current?.focus({ preventScroll: true }); });
  };
  return <>
    <button type="button" ref={trigger} className="measurement-guide-trigger" disabled={!active} aria-haspopup="dialog" onClick={() => { setSelected(initialTopic); popup.onOpenChange(true); }}>
      <BookOpen size={21} /><span>{label}<small>{hint}</small></span><ArrowRight size={18} />
    </button>
    <Dialog {...popup}><DialogContent className="measurement-guide-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); if (active) trigger.current?.focus(); }}>
      <div className="measurement-guide-heading"><span className="dialog-kicker"><Ruler size={16} /> ПАМЯТКА ПО ИЗМЕРЕНИЯМ</span>
        <DialogTitle>Разберёмся с размерами</DialogTitle><DialogDescription>{modelKind ? modelNames[modelKind] : 'Сначала осмотрите деталь, затем выберите тип.'}</DialogDescription>
      </div>
      <nav aria-label="Темы измерений" className="measurement-guide-topics">{lessons.map(item => <button type="button" key={item.topic} aria-current={item.topic === lesson.topic ? 'true' : undefined} aria-controls={contentId} onClick={() => choose(item.topic)}>{item.label}</button>)}</nav>
      <section id={contentId} className="measurement-guide-lesson" aria-labelledby={`${contentId}-title`}>
        <div className="measurement-guide-visual"><MeasurementIllustration diagram={lesson.diagram} /><p className="measurement-guide-note">{lesson.remember}</p></div>
        <div className="measurement-guide-instructions"><h3 id={`${contentId}-title`} ref={title} tabIndex={-1}>{lesson.title}</h3><p>{lesson.intro}</p>
          <ol>{lesson.steps.map(text => <li key={text}>{text}</li>)}</ol>
          <p className="measurement-guide-next"><strong>Дальше</strong>{lesson.next}</p>
        </div>
      </section>
      <DialogClose asChild><button type="button" className="secondary-button measurement-guide-return">Вернуться к вводу <ArrowRight size={17} /></button></DialogClose>
      <DialogClose asChild><button type="button" className="measurement-guide-close" aria-label="Закрыть памятку"><X size={19} /></button></DialogClose>
    </DialogContent></Dialog>
  </>;
}
