/**
 * Frontend: src/components/crm/KanbanBoard.jsx — Board kéo-thả (Kanban)
 *
 * Tổng quan:
 * - Wrapper mỏng quanh `@hello-pangea/dnd` (fork tương thích React 19 của
 *   react-beautiful-dnd, đã có trong package.json).
 * - Mỗi `column` = 1 giai đoạn: header hiện dot màu + label + count + tổng giá trị.
 * - Board là **controlled**: component KHÔNG tự sắp xếp lại state, không tự gọi
 *   API. `onDragEnd` nhận thẳng kết quả của thư viện
 *   `{ draggableId, source: { droppableId, index }, destination, reason }` để page
 *   tự quyết định optimistic update hay refetch.
 * - `id` của cột có thể `null` (deal chưa phân giai đoạn) → đổi thành chuỗi
 *   `"__unassigned__"` vì @hello-pangea/dnd yêu cầu `droppableId` là string.
 *   `onDragEnd` trả lại `destId`/`sourceId` dạng string; page dùng `colKey` ngược lại.
 * - CHỈ tay nắm (grip ở chân thẻ) là drag handle; phần thân thẻ bấm được để mở
 *   chi tiết → không kéo nhầm khi người dùng chỉ muốn click.
 * - `draggableProps.style` + `onTransitionEnd` BẮT BUỘC phải gán: thư viện dùng
 *   chúng để đặt `position:fixed/transform` khi kéo và báo các thẻ còn lại
 *   "rời vị trí". Thiếu style → thẻ đứng yên, chỉ con trỏ di chuyển.
 *
 * Props:
 *   columns:     Array<{ id, label, color, kind, totalValue, items }>
 *   onDragEnd:   (result) => void | Promise<void>
 *   renderCard:  (item, column) => ReactNode
 *   onCardClick: (item, column) => void
 *   loading:     boolean
 *
 * Exports:
 *   KanbanBoard (default). `UNASSIGNED_KEY`/`colKey` nằm ở `constants.jsx`.
 */
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Spin } from "antd";
import { useTranslation } from "react-i18next";
import { HolderOutlined } from "@ant-design/icons";
import { shortMoney, STAGE_ICON, colKey } from "./constants";

export default function KanbanBoard({
  columns = [],
  onDragEnd,
  renderCard,
  onCardClick,
  loading = false,
}) {
  const { t } = useTranslation();

  if (loading && !columns.length) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="kanban-board">
        {columns.map((col) => {
          const dropId = colKey(col.id);
          const items = col.items || [];
          return (
            <Droppable key={dropId} droppableId={dropId}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`kanban-col ${snapshot.isDraggingOver ? "kanban-col--dragging-over" : ""}`}
                >
                  <div className="kanban-col__header">
                    <span
                      className="kanban-col__dot"
                      style={{ background: col.color || "var(--primary)" }}
                    />
                    <span className="kanban-col__label">{col.label}</span>
                    {col.kind && STAGE_ICON[col.kind] && (
                      <span style={{ color: col.color, fontSize: 12 }}>{STAGE_ICON[col.kind]}</span>
                    )}
                    <span className="kanban-col__count">{items.length}</span>
                    {col.totalValue > 0 && (
                      <span
                        className="kanban-col__total"
                        title={`${col.label}: ${Number(col.totalValue).toLocaleString("vi-VN")}`}
                      >
                        {shortMoney(col.totalValue)}
                      </span>
                    )}
                  </div>

                  <div className="kanban-col__body">
                    {items.map((item, index) => (
                      <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            // BẮT BUỘC: style + onTransitionEnd do thư viện cấp —
                            // chúng đặt position:fixed/transform khi đang kéo và
                            // báo "rời vị trí" cho các thẻ còn lại. Bỏ style thì thẻ
                            // đứng yên, chỉ có con trỏ chạy theo chuột.
                            style={{
                              borderLeftColor: col.color || "var(--primary)",
                              ...dragProvided.draggableProps.style,
                            }}
                            onTransitionEnd={dragProvided.draggableProps.onTransitionEnd}
                            className={`kanban-card ${dragSnapshot.isDragging ? "kanban-card--dragging" : ""}`}
                          >
                            <div
                              className="kanban-card__body"
                              role={onCardClick ? "button" : undefined}
                              tabIndex={onCardClick ? 0 : undefined}
                              onClick={onCardClick ? () => onCardClick(item, col) : undefined}
                              onKeyDown={
                                onCardClick
                                  ? (e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        onCardClick(item, col);
                                      }
                                    }
                                  : undefined
                              }
                            >
                              {renderCard ? (
                                renderCard(item, col)
                              ) : (
                                <>
                                  <div className="kanban-card__title">
                                    {item.dealName || item.leadName}
                                  </div>
                                  <div className="kanban-card__value">
                                    {shortMoney(item.value ?? item.expectedValue ?? 0)}
                                  </div>
                                </>
                              )}
                            </div>
                            <div
                              {...dragProvided.dragHandleProps}
                              className="kanban-card__foot"
                              title={t("crmPipeline.dealsBoard.dragToChange")}
                            >
                              <HolderOutlined style={{ color: "var(--text-muted)", fontSize: 12 }} />
                              {col.kind === "ONGOING" && (
                                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                  {t("crmPipeline.dealsBoard.dragToChange")}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {!items.length && !snapshot.isDraggingOver && (
                      <div className="kanban-col__empty">{t("crmPipeline.dealsBoard.emptyCol")}</div>
                    )}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}
