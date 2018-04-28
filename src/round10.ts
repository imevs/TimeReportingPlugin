
/**
 * Корректировка округления десятичных дробей.
 *
 * @param {String}  type  Тип корректировки.
 * @param {Number}  value Число.
 * @param {Integer} exp   Показатель степени (десятичный логарифм основания корректировки).
 * @returns {Number} Скорректированное значение.
 */
function decimalAdjust(type: string, value: number, exp: number) {
    // Если степень не определена, либо равна нулю...
    if (typeof exp === "undefined" || +exp === 0) {
        return (Math as any)[type](value);
    }
    value = +value;
    exp = +exp;
    // Если значение не является числом, либо степень не является целым числом...
    if (isNaN(value) || !(typeof exp === "number" && exp % 1 === 0)) {
        return NaN;
    }
    // Сдвиг разрядов
    const values = value.toString().split("e");
    const values1 = (Math as any)[type](+(values[0] + "e" + (values[1] ? (+values[1] - exp) : -exp)));
    // Обратный сдвиг
    const values2 = values1.toString().split("e");
    return +(values2[0] + "e" + (values2[1] ? (+values2[1] + exp) : exp));
}

export const round10 = (value: number, exp: number) => {
    return decimalAdjust("round", value, exp);
};
