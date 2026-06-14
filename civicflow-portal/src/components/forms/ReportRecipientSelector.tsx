"use client";

import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";

export type ReportRecipientMode =
  | "all_active"
  | "filtered_members"
  | "category"
  | "location"
  | "delinquent"
  | "event_attendees"
  | "meeting_attendees"
  | "manual"
  | "external";

export type ReportRecipientSelectorValue = {
  recipientMode: ReportRecipientMode;
  categoryId: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  eventId: string;
  meetingId: string;
  selectedMemberIds: string[];
  externalEmail: string;
};

type Option = { id: string; label: string };

export function ReportRecipientSelector({
  value,
  onChange,
  members,
  categories,
  events,
  meetings,
}: {
  value: ReportRecipientSelectorValue;
  onChange: (value: ReportRecipientSelectorValue) => void;
  members: Option[];
  categories: Option[];
  events: Option[];
  meetings: Option[];
}) {
  function setField<K extends keyof ReportRecipientSelectorValue>(key: K, fieldValue: ReportRecipientSelectorValue[K]) {
    onChange({ ...value, [key]: fieldValue });
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Recipient group</span>
        <select value={value.recipientMode} onChange={(event) => setField("recipientMode", event.target.value as ReportRecipientMode)} className={fieldClassName}>
          <option value="all_active">All active members with email</option>
          <option value="filtered_members">Filtered members</option>
          <option value="category">Membership category</option>
          <option value="location">City/state/ZIP/county</option>
          <option value="delinquent">Delinquent members</option>
          <option value="event_attendees">Event attendees</option>
          <option value="meeting_attendees">Meeting attendees</option>
          <option value="manual">Manually selected members</option>
          <option value="external">External recipient</option>
        </select>
      </label>

      {value.recipientMode === "filtered_members" ? (
        <p className={helperTextClassName}>Uses the report filters on this form. Members without email addresses are skipped.</p>
      ) : null}

      {value.recipientMode === "category" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Membership category</span>
          <select value={value.categoryId} onChange={(event) => setField("categoryId", event.target.value)} className={fieldClassName}>
            <option value="">Select category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
        </label>
      ) : null}

      {value.recipientMode === "location" ? (
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-2 text-sm font-medium text-slate-900"><span>City</span><input value={value.city} onChange={(event) => setField("city", event.target.value)} className={fieldClassName} /></label>
          <label className="space-y-2 text-sm font-medium text-slate-900"><span>State</span><input value={value.state} onChange={(event) => setField("state", event.target.value)} className={fieldClassName} /></label>
          <label className="space-y-2 text-sm font-medium text-slate-900"><span>ZIP</span><input value={value.zipCode} onChange={(event) => setField("zipCode", event.target.value)} className={fieldClassName} /></label>
          <label className="space-y-2 text-sm font-medium text-slate-900"><span>County</span><input value={value.county} onChange={(event) => setField("county", event.target.value)} className={fieldClassName} /></label>
        </div>
      ) : null}

      {value.recipientMode === "event_attendees" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Event</span>
          <select value={value.eventId} onChange={(event) => setField("eventId", event.target.value)} className={fieldClassName}>
            <option value="">Select event</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
          </select>
        </label>
      ) : null}

      {value.recipientMode === "meeting_attendees" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Meeting</span>
          <select value={value.meetingId} onChange={(event) => setField("meetingId", event.target.value)} className={fieldClassName}>
            <option value="">Select meeting</option>
            {meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.label}</option>)}
          </select>
        </label>
      ) : null}

      {value.recipientMode === "manual" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Members</span>
          <select
            multiple
            value={value.selectedMemberIds}
            onChange={(event) => setField("selectedMemberIds", Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
            className={`${fieldClassName} min-h-40`}
          >
            {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
          </select>
        </label>
      ) : null}

      {value.recipientMode === "external" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>External recipient email</span>
          <input type="email" value={value.externalEmail} onChange={(event) => setField("externalEmail", event.target.value)} className={fieldClassName} />
        </label>
      ) : null}
    </div>
  );
}
