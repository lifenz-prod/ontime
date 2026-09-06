import { IoRefresh } from 'react-icons/io5';
import { IconButton, Select, Switch } from '@chakra-ui/react';
import { type PcoItemImportAs, type PcoPlanSheetItem, type PcoRuleEffect,EndAction } from 'ontime-types';
import { millisToString, removeLeadingZero } from 'ontime-utils';

import { endActionOptions } from '../../common/utils/endAction';
import {
  type ToggleKey,
  applyEndAction,
  applyImportAs,
  applyTiming,
  applyToggle,
  importAsLabels,
  importAsOf,
  timingOf,
  toggleKeys,
  toggleLabels,
} from '../app-settings/panel/pco-panel/pcoRuleUtils';

import style from './PcoImport.module.scss';

interface PcoRunSheetProps {
  items: PcoPlanSheetItem[];
  /** true when this service type holds a choice of its own for the title */
  isCustomised: (title: string) => boolean;
  /** what this service type explicitly holds for the title, which is what a change edits */
  ownEffect: (title: string) => PcoRuleEffect;
  onChange: (title: string, effect: PcoRuleEffect) => void;
  onReset: (title: string) => void;
}

const lengthLabel = (millis: number): string => (millis > 0 ? removeLeadingZero(millisToString(millis)) : '--');

/**
 * The time of day a row starts.
 *
 * Seconds only when there are any. The production run sits on whole minutes and a
 * column of "08:20:00" reads worse than "08:20", but the run sheet's own rows are
 * laid out by adding up lengths and land wherever that puts them -- doors running
 * 13:20 puts the video at 08:58:20, and rounding that off would be a lie the
 * Length column beside it immediately contradicts.
 */
const clockLabel = (millis: number): string => {
  const clock = millisToString(millis);
  return clock.endsWith(':00') ? clock.slice(0, 5) : clock;
};

/**
 * What a row is doing instead of taking a cue of its own, and null when it has one.
 *
 * Said rather than enforced: every row can be asked for as a timed event, which is
 * the only way somebody reading the sheet can give a cue to something the rules
 * folded or merged away. This is why its time is not where you might look for it.
 */
const noCueReason: Partial<Record<PcoPlanSheetItem['disposition'], string>> = {
  merged: 'merged into the entry above',
};

export default function PcoRunSheet({ items, isCustomised, ownEffect, onChange, onReset }: PcoRunSheetProps) {
  if (items.length === 0) {
    return <div className={style.empty}>This plan has no items.</div>;
  }

  return (
    <div className={style.scroller}>
      <table className={style.sheet}>
        <thead>
          <tr>
            <th>Item</th>
            <th className={style.fit}>Starts</th>
            <th className={style.fit}>Length</th>
            <th className={style.fit}>Import as</th>
            <th className={style.fit}>At the end</th>
            <th className={style.fit}>Fixed duration</th>
            <th className={style.fit}>Hide timer</th>
            <th className={style.fit}>Aux timer</th>
            <th className={style.fit}>Skip</th>
            <th className={style.fit} />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <RunSheetRow
              key={item.id}
              item={item}
              isCustomised={isCustomised(item.title)}
              ownEffect={ownEffect(item.title)}
              onChange={(effect) => onChange(item.title, effect)}
              onReset={() => onReset(item.title)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RunSheetRowProps {
  item: PcoPlanSheetItem;
  isCustomised: boolean;
  ownEffect: PcoRuleEffect;
  onChange: (effect: PcoRuleEffect) => void;
  onReset: () => void;
}

function RunSheetRow({ item, isCustomised, ownEffect, onChange, onReset }: RunSheetRowProps) {
  const reason = noCueReason[item.disposition];
  const importAs = importAsOf(item.disposition);

  /**
   * A row that is not a timed event carries no timer settings, so those controls are
   * disabled -- but "Import as" never is. Asking for a timed event takes an item out
   * of a fold, out of a merge or off the ignore list, and there is no other way to
   * do that from here.
   */
  const noTimer = importAs !== 'event';

  /**
   * Two effects, and the difference is the point. The controls read `shown`, the
   * fully resolved effect, so a row says what the import will really do. A change
   * is applied to `ownEffect`, so a rule ends up holding only what was actually
   * chosen and everything else keeps following the defaults.
   */
  const shown = item.effect;
  const effect = ownEffect;

  return (
    <tr data-inert={noTimer}>
      <td>
        <span className={style.itemTitle}>{item.title || 'Untitled'}</span>
        {item.source === 'rehearsal' && <span className={style.badge}>rehearsal time</span>}
        {item.source === 'lead-in' && <span className={style.badge}>lead-in</span>}
        {item.source === 'item' && item.itemType === 'song' && <span className={style.badge}>song</span>}
        {item.source === 'item' && item.itemType === 'header' && <span className={style.badge}>heading</span>}
        {item.source === 'item' && item.servicePosition === 'pre' && <span className={style.badge}>pre-service</span>}
        {item.includedIn && <span className={style.muted}> · included in {item.includedIn}</span>}
        {item.follows && <span className={style.muted}> · added after {item.follows}</span>}
        {/* not a rule anybody set: PCO itself says this half of the pair is the other
            service's, and the mirror is what generates that one */}
        {item.excludedFrom && (
          <span className={style.muted}> · not in {item.excludedFrom} in Planning Center</span>
        )}
        {item.alongside && item.source === 'rehearsal' && (
          <span className={style.muted}> · alongside {item.alongside}</span>
        )}
        {/* where a folded row's time went, since "leave out" would otherwise imply it was lost */}
        {item.alongside && item.disposition === 'collapsed' && (
          <span className={style.muted}> · its time is in {item.alongside}</span>
        )}
        {reason && <span className={style.muted}> · {reason}</span>}
        {isCustomised && <span className={`${style.badge} ${style.customised}`}>set for this service type</span>}
      </td>
      <td className={style.numeric}>{item.startsAt === null ? '' : clockLabel(item.startsAt)}</td>
      <td className={style.numeric}>{lengthLabel(item.duration)}</td>

      <td className={style.fit}>
        <Select
          size='sm'
          width='9rem'
          variant='ontime'
          value={importAs}
          onChange={(event) => onChange(applyImportAs(effect, event.target.value as PcoItemImportAs))}
        >
          {Object.entries(importAsLabels).map(([choice, label]) => (
            <option key={choice} value={choice}>
              {label}
            </option>
          ))}
        </Select>
      </td>

      <td className={style.fit}>
        <Select
          size='sm'
          width='11rem'
          variant='ontime'
          value={shown.endAction ?? EndAction.None}
          isDisabled={noTimer}
          onChange={(event) => onChange(applyEndAction(effect, event.target.value as EndAction))}
        >
          {endActionOptions.map(([action, label]) => (
            <option key={action} value={action}>
              {label}
            </option>
          ))}
        </Select>
      </td>

      <td className={style.fit}>
        {/* off is not "count down to a time", it is "no opinion": the row keeps
            following defaultEffect, which is what counts down to a time */}
        <Switch
          variant='ontime'
          size='md'
          aria-label={`Fixed duration for ${item.title}`}
          isChecked={timingOf(shown) === 'fixed-duration'}
          isDisabled={noTimer}
          onChange={(event) => onChange(applyTiming(effect, event.target.checked ? 'fixed-duration' : 'default'))}
        />
      </td>

      {toggleKeys.map((key: ToggleKey) => (
        <td key={key} className={style.fit}>
          <Switch
            variant='ontime'
            size='md'
            aria-label={`${toggleLabels[key].title} for ${item.title}`}
            isChecked={Boolean(shown[key])}
            isDisabled={noTimer}
            onChange={(event) => onChange(applyToggle(effect, key, event.target.checked))}
          />
        </td>
      ))}

      <td className={style.fit}>
        <IconButton
          size='sm'
          variant='ontime-ghosted'
          aria-label={`Reset ${item.title} to the defaults`}
          icon={<IoRefresh />}
          isDisabled={!isCustomised}
          onClick={onReset}
        />
      </td>
    </tr>
  );
}
