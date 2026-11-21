import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/js/site.js', import.meta.url), 'utf8');
const selection = source.slice(source.indexOf('  async function selectTour('), source.indexOf('  function tourEntryFor('));
for (const expired of [true, false]) {
  test(expired ? 'past operating period explains empty calendar' : 'future tour requests its operating window and allows a single remaining seat', async () => {
    const tour = { id: 'fixture', startDate: '2030-03-01', endDate: '2030-03-02', minParticipants: 15 };
    const state = { tours: [tour], site: { today: expired ? '2030-04-01' : '2030-01-01', settings: { booking: { advanceDays: 120 } } } };
    const queries = [];
    let note, selected;
    const context = vm.createContext({ state, currentTour: () => tour, renderDates() {}, renderTimes() {}, setText() {}, track() {},
      renderTourOptions() {}, updatePaxControls() {}, renderSummary() {}, selectDate: date => { selected = date; },
      showAvailabilityNote: text => { note = text; },
      api: async path => {
        queries.push(path);
        return { daysList: [{ date: tour.startDate, tours: [] }, { date: tour.endDate, tours: [{ tourId: tour.id, departures: [{ left: 1, status: 'last' }] }] }] };
      }
    });
    vm.runInContext(selection, context);
    await context.selectTour(tour.id);
    assert.equal(state.pax, 1);
    if (expired) {
      assert.equal(queries.length, 0);
      assert.match(note, /terminó/);
    } else {
      assert.deepEqual(queries, ['/api/availability?tour=fixture&days=2&from=2030-03-01']);
      assert.equal(state.availability.length, 1);
      assert.equal(selected, tour.endDate);
    }
  });
}
