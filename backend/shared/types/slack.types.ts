// Slack Integration Types

export interface SlackNotification {
  type: 'checkin_reminder' | 'checkout_reminder' | 'violation_alert' | 'vacation_request';
  employee_id: string;
  slack_user_id: string;
  message: string;
  blocks?: any[];
}

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
  attachments?: any[];
}
