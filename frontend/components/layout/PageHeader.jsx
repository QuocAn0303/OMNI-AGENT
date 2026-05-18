/**
 * PageHeader — Tiêu đề trang + subtitle + actions
 *
 * Props:
 *   title:    string — bắt buộc
 *   subtitle: string — phụ đề (thường là count hoặc mô tả ngắn)
 *   actions:  ReactNode — nút hành động (Thêm mới, Export...)
 */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div className="page-header__row">
        <div>
          <h1 className="page-header__title">{title}</h1>
          {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </div>
  );
}
