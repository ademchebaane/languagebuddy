/* Starter words shown before the complete HSK data is downloaded. */
window.LANGUAGE_BUDDY_SEED = [
  ["我","wǒ","I; me","r",1,11], ["你","nǐ","you","r",1,12], ["他","tā","he; him","r",1,13],
  ["她","tā","she; her","r",1,25], ["是","shì","to be; yes","v",1,4], ["不","bù","no; not","d",1,9],
  ["有","yǒu","to have; there is","v",1,18], ["在","zài","to be at; in; on","v",1,10], ["这","zhè","this","r",1,14],
  ["那","nà","that","r",1,15], ["好","hǎo","good; well","a",1,20], ["人","rén","person; people","n",1,16],
  ["学生","xuésheng","student","n",1,390], ["老师","lǎoshī","teacher","n",1,300], ["学校","xuéxiào","school","n",1,500],
  ["学习","xuéxí","to study; to learn","v",1,215], ["中国","Zhōngguó","China","ns",1,100], ["中文","Zhōngwén","Chinese language","n",1,700],
  ["喜欢","xǐhuan","to like; to enjoy","v",1,80], ["吃","chī","to eat","v",1,142], ["喝","hē","to drink","v",1,428],
  ["看","kàn","to look; to watch; to read","v",1,75], ["去","qù","to go","v",1,22], ["来","lái","to come","v",1,24],
  ["大","dà","big; large","a",1,66], ["小","xiǎo","small; little","a",1,28], ["水","shuǐ","water","n",1,45],
  ["茶","chá","tea","n",1,1910], ["家","jiā","home; family","n",1,36], ["朋友","péngyou","friend","n",1,180],
  ["今天","jīntiān","today","t",1,52], ["明天","míngtiān","tomorrow","t",1,57], ["谢谢","xièxie","thank you","v",1,800]
].map((w) => ({ word:w[0], traditional:w[0], pinyin:w[1], meaning:w[2], pos:[w[3]], level:w[4], frequency:w[5], id:`${w[4]}-${w[0]}` }));
