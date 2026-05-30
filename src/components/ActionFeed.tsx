import { KeyboardEvent } from 'react';
import { HandEvent, Street } from '../nlheEngine';
import { formatMoney } from '../utils/format';

const HIDDEN_REPLAY_ACTION_TYPES = new Set<HandEvent['actionType']>(['deal', 'small-blind', 'big-blind']);

export function isUserFacingReplayEvent(event: HandEvent) {
  return !HIDDEN_REPLAY_ACTION_TYPES.has(event.actionType);
}

function formatEventAmount(event: HandEvent) {
  return event.amount ? formatMoney(event.amount) : '';
}

function eventTimeLabel(events: HandEvent[], index: number) {
  const newerCount = events.length - index - 1;
  return newerCount === 0 ? 'now' : `${newerCount} ago`;
}

function streetDividerLabel(event: HandEvent) {
  if (event.action !== 'Deal street') return event.street;
  const dealt = event.note.replace(/^Burned one and dealt /, '').replace(/\. Betting round.*$/, '');
  return `${event.street} - ${dealt}`;
}

export function ActionFeed({ events, selectedEvent, onSelect, onKeyDown }: {
  events: HandEvent[];
  selectedEvent: number;
  onSelect: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const feedEvents = events.map((event, index) => ({ event, index })).reverse();
  let previousStreet: Street | null = null;

  return (
    <div aria-label="Current hand action feed" className="timeline action-feed" onKeyDown={onKeyDown} role="listbox" tabIndex={0}>
      {feedEvents.length === 0 ? (
        <p className="timeline-empty">Player decisions will appear here once action starts.</p>
      ) : feedEvents.map(({ event, index }) => {
        const showStreetDivider = event.street !== previousStreet;
        previousStreet = event.street;
        return (
          <div className="action-feed-group" key={event.id}>
            {showStreetDivider && (
              <div className="street-divider" aria-label={`${event.street} street`}>
                <span>{streetDividerLabel(event)}</span>
              </div>
            )}
            <button aria-selected={selectedEvent === index} className={selectedEvent === index ? 'timeline-item action-feed-item active' : 'timeline-item action-feed-item'} onClick={() => onSelect(index)} role="option" type="button">
              <span className="action-position">{event.position ?? ''}</span>
              <strong>{event.actor}</strong>
              <span>{event.action}</span>
              <span>{formatEventAmount(event)}</span>
              <time>{eventTimeLabel(events, index)}</time>
            </button>
          </div>
        );
      })}
    </div>
  );
}
