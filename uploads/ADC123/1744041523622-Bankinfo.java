import java.util.Scanner;
class Bankinfo
{
public static void main(String args[])
{
Scanner input=new Scanner(System.in);
System.out.print("Enter the Initialbalance:");
double initialbalance=input.nextDouble();
double balance=initialbalance;
    double amount;
    
while(true)
{
    
System.out.println("Choose an option:");
System.out.println("\n 1.Deposit");
System.out.println(" 2.Withdrawl");
System.out.println(" 3.balance checking");
System.out.println(" 4.Exit");
System.out.print("\n select your choice(1/2/3/4):");
int choice=input.nextInt();
switch(choice)
{
case 1:
System.out.print("Enter the deposite amount: ");

 amount=input.nextDouble();
 balance+=amount;
 System.out.println("Deposite is successful .. your current balance is "+balance);
break;

case 2:
System.out.print("\nEnter the withdrawl amount:");
    
amount=input.nextDouble();

if(amount>balance)
{
System.out.println("insufficient balance.. withdrawal is failed");
}
else
{
balance-=amount;


System.out.println("Withdrawal is successful.. current balance is "+balance);
}
break;

case 3:
System.out.println("your current balance is "+balance);
break;

case 4:
System.out.println("Exiting from the  program");
System.exit(0);
break;
default:
System.out.println("invalid choice ");
}
}
}
}

