export default function SkeletonCard() {
  return (
    <div className="card-skeleton" aria-hidden="true">
      <div className="skeleton card-skeleton__line" style={{ width: '42%' }} />
      <div className="skeleton card-skeleton__title" style={{ width: '92%' }} />
      <div className="skeleton card-skeleton__title" style={{ width: '68%', marginTop: 0 }} />
      <div className="card-skeleton__chips">
        <span className="skeleton card-skeleton__chip" />
        <span className="skeleton card-skeleton__chip" style={{ width: 42 }} />
        <span className="skeleton card-skeleton__chip" style={{ width: 68 }} />
      </div>
      <div className="skeleton card-skeleton__spark" />
      <div className="skeleton card-skeleton__price" />
      <div className="skeleton card-skeleton__line" style={{ width: '100%', marginTop: 4 }} />
    </div>
  )
}
