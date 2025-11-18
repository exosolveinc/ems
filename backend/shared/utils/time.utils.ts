// Time Utility Functions

export function calculateTotalHours(
  startTime: Date,
  endTime: Date
): number {
  const diffMs = endTime.getTime() - startTime.getTime();
  return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
}

export function isLateCheckIn(checkInTime: Date, workStartTime: string = '09:00'): boolean {
  const [hours, minutes] = workStartTime.split(':').map(Number);
  const workStart = new Date(checkInTime);
  workStart.setHours(hours, minutes, 0, 0);
  
  return checkInTime > workStart;
}

export function getMinutesLate(checkInTime: Date, workStartTime: string = '09:00'): number {
  const [hours, minutes] = workStartTime.split(':').map(Number);
  const workStart = new Date(checkInTime);
  workStart.setHours(hours, minutes, 0, 0);
  
  if (checkInTime <= workStart) return 0;
  
  return Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60));
}

export function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}
