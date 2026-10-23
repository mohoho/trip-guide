type StudioIntroProps = {
  step: 1 | 2 | 3
  title: string
  description: string
  detail?: string
}

/** A shared editorial heading keeps the creation flow visually connected. */
export function StudioIntro({ step, title, description, detail }: StudioIntroProps) {
  return <div className="studio-intro">
    <div><p className="journal-eyebrow">THE WANDERER’S STUDIO / 0{step}</p>
      <h1>{title}</h1><p>{description}</p></div>
    <div className="studio-intro-detail">
      <ol aria-label="创作步骤">{['确定范围', '地图选点', '内容创作'].map((label, i) =>
        <li key={label} aria-current={i + 1 === step ? 'step' : undefined}><span>0{i + 1}</span>{label}</li>)}</ol>
      {detail && <p>{detail}</p>}
    </div>
  </div>
}
