import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export const TZ = 'Asia/Ho_Chi_Minh'

export function formatDate(value, fmt = 'DD/MM/YYYY') {
  if (!value) return ''
  return dayjs.utc(value).tz(TZ).format(fmt)
}

export function formatDateTime(value) {
  if (!value) return ''
  return dayjs.utc(value).tz(TZ).format('DD/MM/YYYY HH:mm')
}

export function formatTime(value) {
  if (!value) return ''
  return dayjs.utc(value).tz(TZ).format('HH:mm')
}

export { dayjs }
