import { round10 } from "./round10";

const user = "vmedvedev";
const domain = "https://jira.com";
const url = domain + "/rest/api/2/search?fields=worklog&expand=changelog&jql=" +
    encodeURIComponent(
        `status was in ("In Progress") BY ${user} ` +
        `during (2018-03-01, 2018-03-10) and updated >= 2018-03-01`);

interface InputData {
    issues: {
        key: string;
        fields: {
            worklog: {
                worklogs: {
                    author: {
                        name: string;
                    },
                    created: string;
                    updated: string;
                    started: string;
                    timeSpentSeconds: number;
                }[];
            };
        },
        changelog: {
            histories: {
                // author: {
                //     name: string,
                // },
                created: string;
                items: {
                   field: "status"/* | "timespent"*/;
                   fromString: string;
                   toString: string;
                }[]
            }[],
        }
    }[];
}

interface ReportItem {
    total: number;
    [ticket: string]: number | undefined; // logged hours
}
interface Report {
    [date: string]: ReportItem | undefined;
}
type SpendHours = {
    key: string;
    inProgress: {
        date: number;
        period: string;
        time: number;
    }[][];
}[];

const data: InputData = require("./tempo_data");

const isCurrentMonth = (d: Date) => d.getUTCMonth() === 2 && d.getUTCFullYear() === 2018;

const getHourWithMinutes = (from: Date) => from.getUTCHours() + from.getMinutes() / 60;

const workHourFrom = 10;
const workHourTo = 18;
const workingDays = [1, 2, 3, 4, 5];
const listOfStatuses: string[] = ["Ready for Review", "In Progress"];
const standardWorkDayDuration = workHourTo - workHourFrom;
const generateWorkHours = (): { [K: number]: { from: number; to: number; }} => {
    const startDate = 1;
    const endDate = 31;
    const result: { [K: number]: { from: number; to: number; }} = {};
    const statusUpdates = data.issues
        .map((issue) =>
            issue.changelog.histories.filter((history) =>
                history.items.some((item) =>
                    item.field === "status" &&
                    (
                        listOfStatuses.indexOf(item.toString) !== -1 ||
                        listOfStatuses.indexOf(item.fromString) !== -1
                    ),
                ),
            ).map((item) => item.created),
        )
        .reduce((acc, i) => acc.concat(i), [])
        .sort()
        .map((item) => new Date(item))
        .filter(isCurrentMonth);
    for (let i = startDate; i <= endDate; i++) {
        const filterFn = (date: number) => (d: Date) => d.getUTCDate() === date;
        const updatesDuringCurrentDate = statusUpdates.filter(filterFn(i));
        const from = updatesDuringCurrentDate[0];
        const to = updatesDuringCurrentDate[updatesDuringCurrentDate.length - 1];
        result[i] = {
            from: Math.min(from ? getHourWithMinutes(from) : 24, workHourFrom),
            to: Math.max(to ? getHourWithMinutes(to) : 0, workHourTo),
        };
    }
    return result;
};

const workHours = generateWorkHours();

const getHoursSpendOnTicketsInStatus = (status: string): SpendHours => {
    return data.issues.map((issue) => {
        const from = issue.changelog.histories.filter((history) =>
            history.items.some((item) =>
            item.field === "status" && item.toString === status),
        ).map((item) => item.created);
        const to = issue.changelog.histories.filter((history) =>
            history.items.some((item) =>
            item.field === "status" && item.fromString === status),
        ).map((item) => item.created);

        const inProgress = from.map((date, i) => {
            const currentDay = new Date(date);
            if (!isCurrentMonth(currentDay)) {
                return [];
            }

            const t = new Date(to[i]);
            const workedHours = [];
            while (currentDay.getUTCDate() <= t.getUTCDate()) {
                if (workingDays.indexOf(currentDay.getUTCDay()) !== -1) {
                    const endTime = currentDay.getUTCDate() === t.getUTCDate()
                        ? getHourWithMinutes(t) : workHours[currentDay.getUTCDate()].to;
                    const fromTime = getHourWithMinutes(currentDay);

                    const time = endTime - fromTime;
                    if (time > 0.5) {
                        workedHours.push({
                            date: currentDay.getUTCDate(),
                            period: fromTime + "-" + endTime,
                            time,
                        });
                    }
                }
                currentDay.setUTCDate(currentDay.getUTCDate() + 1);
                currentDay.setUTCHours(workHours[currentDay.getUTCDate()].from);
                currentDay.setUTCMinutes(0);
            }

            return workedHours;
        }).filter((i) => !!i.length);

        return { key: issue.key, inProgress };
    });
};

const reportedHoursInProgress = getHoursSpendOnTicketsInStatus("In Progress");
const reportedHoursReview = getHoursSpendOnTicketsInStatus("Ready for Review");
const allReportedHours = [...reportedHoursInProgress, ...reportedHoursReview];

const autoReport: Report = {};
allReportedHours.forEach((issue) => {
    issue.inProgress.forEach((record) => {
        record.forEach((day) => {
            const reportItem = autoReport[day.date] || { total: 0 };
            reportItem[issue.key] = (reportItem[issue.key] || 0) + day.time;
            autoReport[day.date] = reportItem;
        });
    });
});

const manualReport: Report = {};

data.issues.forEach((issue) => {
    issue.fields.worklog.worklogs.forEach((worklog) => {
        const date = new Date(worklog.started);
        if (isCurrentMonth(date) && worklog.author.name === user) {
            const utcDate = date.getUTCDate();
            const reportItem = manualReport[utcDate] = manualReport[utcDate] || { total: 0 };
            const hours = worklog.timeSpentSeconds / (60 * 60);
            reportItem.total += hours;
            reportItem[issue.key] = (reportItem[issue.key] || 0) + hours;
        }
    });
});

const correctedReport: Report = {};
Object.keys(autoReport).forEach((date) => {
    const correctedReportItem: ReportItem = correctedReport[date] = { total: 0 };
    Object.keys(autoReport[date] || {}).forEach((key) => {
        correctedReportItem[key] = Math.max(0,
            (autoReport[date] && autoReport[date]![key] || 0) -
            (manualReport[date] && manualReport[date]![key] || 0));
    });

    const totalAutoReportedHours = Object.keys(autoReport[date] || {})
        .reduce((acc: number, key) => acc + (correctedReportItem && correctedReportItem[key] || 0), 0);

    const reportedManuallyHours = manualReport[date] ? manualReport[date]!.total : 0;
    const hoursCouldBeAutoReported = Math.max(0, standardWorkDayDuration - reportedManuallyHours);
    const hoursWantsToBeAutoReported = Math.max(hoursCouldBeAutoReported, totalAutoReportedHours);
    const koef = hoursWantsToBeAutoReported ? (hoursCouldBeAutoReported / hoursWantsToBeAutoReported) : 0;

    correctedReportItem.manually = reportedManuallyHours;
    Object.keys(autoReport[date] || {}).forEach((key) => {
        correctedReportItem[key] = koef * Math.max(0, correctedReportItem[key] || 0);
        correctedReportItem.total += correctedReportItem[key] || 0;
    });
    correctedReportItem.total += reportedManuallyHours;
});

const formatReport = (rep: Report) => {
    Object.keys(rep).forEach((item) => {
        Object.keys(rep[item] || {}).forEach((prop) => {
            const val = rep[item]![prop];
            rep[item]![prop] = round10(val || 0, -2);
        });
    });
    return rep;
};
console.log("manualReport", formatReport(manualReport));
console.log("autoReport", formatReport(autoReport));
console.log("correctedReport", formatReport(correctedReport));
