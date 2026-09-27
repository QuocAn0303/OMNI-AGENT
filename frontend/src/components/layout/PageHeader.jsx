/**
 * PageHeader — Tiêu đề trang + subtitle + actions
 *
 * Props:
 *   title:    string — bắt buộc
 *   subtitle: string — phụ đề (thường là count hoặc mô tả ngắn)
 *   actions:  ReactNode — nút hành động (Thêm mới, Export...)
 *   extra:    ReactNode — alias của actions (tương thích antd PageHeader cũ)
 */
export default function PageHeader({ title, subtitle, actions, extra }) {
  const right = actions || extra;
  return (
    <div className="page-header">
      <div className="page-header__row">
        <div>
          <h1 className="page-header__title">{title}</h1>
          {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
        </div>
        {right && <div className="page-header__actions">{right}</div>}
      </div>
    </div>
  );
}

